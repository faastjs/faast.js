import { Archiver } from "archiver";
import * as fs from "fs";
import * as path from "path";
import * as webpack from "webpack";
import { CloudifyLoaderOptions } from "./cloudify-loader";
import { log } from "./log";
import MemoryFileSystem = require("memory-fs");
import archiver = require("archiver");
import * as JSZip from "jszip";
import { streamToBuffer } from "./shared";
import { promisify } from "util";

export interface PackerOptions {
    webpackOptions?: webpack.Configuration;
    packageJson?: string | object | false;
    addDirectory?: string | string[];
    addZipFile?: string | string[];
}

const readFile = promisify(fs.readFile);

export interface PackerResult {
    archive: NodeJS.ReadableStream;
    indexContents: string;
}

function getUrlEncodedQueryParameters(options: CloudifyLoaderOptions) {
    return Object.keys(options)
        .filter(key => options[key])
        .map(key => `${key}=${encodeURIComponent(options[key])}`)
        .join(`&`);
}

export function packer(
    loaderOptions: CloudifyLoaderOptions,
    {
        webpackOptions = {},
        packageJson,
        addDirectory,
        addZipFile,
        ...otherPackerOptions
    }: PackerOptions
): Promise<PackerResult> {
    const _exhaustiveCheck: Required<typeof otherPackerOptions> = {};
    log(`Running webpack`);
    const loader = `cloudify-loader?${getUrlEncodedQueryParameters(loaderOptions)}!`;

    const config: webpack.Configuration = {
        entry: loader,
        mode: "development",
        output: {
            path: "/",
            filename: "index.js",
            libraryTarget: "commonjs2"
        },
        target: "node",
        resolveLoader: { modules: [__dirname, `${__dirname}/build}`] },
        ...webpackOptions
    };

    function addToArchive(mfs: MemoryFileSystem, root: string, archive: Archiver) {
        function addEntry(entry: string) {
            const stat = mfs.statSync(entry);
            if (stat.isDirectory()) {
                for (const subEntry of mfs.readdirSync(entry)) {
                    const subEntryPath = path.join(entry, subEntry);
                    addEntry(subEntryPath);
                }
            } else if (stat.isFile()) {
                archive.append((mfs as any).createReadStream(entry), {
                    name: path.relative(root, entry)
                });
            }
        }
        addEntry(root);
    }

    function addPackageJson(mfs: MemoryFileSystem, packageJsonFile: string | object) {
        const parsedPackageJson =
            typeof packageJsonFile === "string"
                ? JSON.parse(fs.readFileSync(packageJsonFile).toString())
                : packageJsonFile;
        parsedPackageJson.main = "index.js";
        mfs.writeFileSync(
            "/package.json",
            JSON.stringify(parsedPackageJson, undefined, 2)
        );
        return Object.keys(parsedPackageJson.dependencies);
    }

    function processAddDirectories(archive: Archiver, directories: string[]) {
        for (const dir of directories) {
            log(`Adding directory to archive: ${dir}`);
            archive.directory(dir, false);
        }
    }

    async function processAddZips(archive: Archiver, zipFiles: string[]) {
        if (zipFiles.length === 0) {
            return;
        }
        const zip = new JSZip();
        await zip.loadAsync(await streamToBuffer(archive));
        for (const zipFile of zipFiles) {
            await zip.loadAsync(await readFile(zipFile));
        }

        return zip.generateNodeStream({
            compression: "DEFLATE",
            compressionOptions: { level: 8 }
        });
    }

    async function prepareZipArchive(mfs: MemoryFileSystem): Promise<PackerResult> {
        const archive = archiver("zip", { zlib: { level: 8 } });
        addToArchive(mfs, "/", archive);
        if (typeof addDirectory === "string") {
            addDirectory = [addDirectory];
        }
        addDirectory && processAddDirectories(archive, addDirectory);
        archive.finalize();
        if (typeof addZipFile === "string") {
            addZipFile = [addZipFile];
        }
        const result =
            (addZipFile && (await processAddZips(archive, addZipFile))) || archive;
        const indexContents = mfs.readFileSync("/index.js").toString();
        return { archive: result, indexContents };
    }

    return new Promise<PackerResult>((resolve, reject) => {
        const mfs = new MemoryFileSystem();
        const dependencies = (packageJson && addPackageJson(mfs, packageJson)) || [];
        const { externals = [] } = webpackOptions;
        const externalsArray = Array.isArray(externals) ? externals : [externals];
        config.externals = [...externalsArray, ...dependencies];

        log(`webpack config: %O`, config);
        const compiler = webpack(config);

        compiler.outputFileSystem = mfs;
        compiler.run((err, stats) => {
            if (err) {
                reject(err);
            } else {
                log(stats.toString());
                log(`Memory filesystem: %O`, mfs.data);
                resolve(prepareZipArchive(mfs));
            }
        });
    });
}

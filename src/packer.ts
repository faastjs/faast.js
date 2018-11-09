import { Archiver } from "archiver";
import * as fs from "fs";
import * as path from "path";
import * as webpack from "webpack";
import { LoaderOptions } from "./cloudify-loader";

import { log, warn } from "./log";
import MemoryFileSystem = require("memory-fs");
import archiver = require("archiver");
import * as JSZip from "jszip";
import { streamToBuffer } from "./shared";
import { promisify } from "util";
import { Trampoline } from "./trampoline";

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

function getUrlEncodedQueryParameters(options: LoaderOptions) {
    return Object.keys(options)
        .filter(key => options[key])
        .map(key => `${key}=${encodeURIComponent(options[key])}`)
        .join(`&`);
}

export async function packer(
    mode: "immediate" | "childprocess",
    trampolineModule: Trampoline,
    functionModule: string,
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
    const mfs = new MemoryFileSystem();

    function addToArchive(root: string, archive: Archiver) {
        function addEntry(entry: string) {
            const stat = mfs.statSync(entry);
            if (stat.isDirectory()) {
                for (const subEntry of mfs.readdirSync(entry)) {
                    const subEntryPath = path.join(entry, subEntry);
                    addEntry(subEntryPath);
                }
            } else if (stat.isFile()) {
                log(`Adding file: ${entry}`);
                archive.append((mfs as any).createReadStream(entry), {
                    name: path.relative(root, entry)
                });
            }
        }
        addEntry(root);
    }

    function addPackageJson(packageJsonFile: string | object) {
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
            if (!fs.existsSync(dir)) {
                warn(`Directory ${dir} not found`);
            }
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

    async function prepareZipArchive(): Promise<PackerResult> {
        const archive = archiver("zip", { zlib: { level: 8 } });
        archive.on("error", err => warn(err));
        archive.on("warning", err => warn(err));
        addToArchive("/", archive);
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

    const dependencies = (packageJson && addPackageJson(packageJson)) || [];
    const { externals = [] } = webpackOptions;
    const externalsArray = Array.isArray(externals) ? externals : [externals];

    function runWebpack(entry: string, outputFilename: string) {
        const config: webpack.Configuration = {
            entry,
            mode: "development",
            output: {
                path: "/",
                filename: outputFilename,
                libraryTarget: "commonjs2"
            },
            target: "node",
            resolveLoader: { modules: [__dirname, `${__dirname}/build}`] },
            ...webpackOptions
        };
        config.externals = [...externalsArray, ...dependencies];
        log(`webpack config: %O`, config);
        const compiler = webpack(config);
        compiler.outputFileSystem = mfs as any;
        return new Promise((resolve, reject) =>
            compiler.run((err, stats) => {
                if (err) {
                    reject(err);
                } else {
                    log(stats.toString());
                    log(`Memory filesystem: %O`, mfs.data);
                    resolve();
                }
            })
        );
    }

    if (mode === "immediate") {
        const loader = `cloudify-loader?${getUrlEncodedQueryParameters({
            type: "immediate",
            trampolineModule: trampolineModule.filename,
            functionModule
        })}!`;
        await runWebpack(loader, "index.js");
        return prepareZipArchive();
    } else if (mode === "childprocess") {
        const parentLoader = `cloudify-loader?${getUrlEncodedQueryParameters({
            type: "parent",
            trampolineModule: trampolineModule.filename
        })}!`;
        await runWebpack(parentLoader, "index.js");

        const childLoader = `cloudify-loader?${getUrlEncodedQueryParameters({
            type: "child",
            moduleWrapper: require.resolve("./trampoline"),
            functionModule
        })}!`;
        await runWebpack(childLoader, "child-index.js");
        return prepareZipArchive();
    } else {
        throw new Error(`Unknown mode ${mode}`);
    }
}

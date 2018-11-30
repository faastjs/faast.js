import { Archiver } from "archiver";
import * as fs from "fs";
import * as path from "path";
import { Readable } from "stream";
import { promisify } from "util";
import * as webpack from "webpack";
import * as yauzl from "yauzl";
import { LoaderOptions } from "./cloudify-loader";
import { info, warn } from "./log";
import { streamToBuffer, rmrf } from "./shared";
import { TrampolineFactory, ModuleWrapperOptions } from "./module-wrapper";

type ZipFile = yauzl.ZipFile;

import MemoryFileSystem = require("memory-fs");
import archiver = require("archiver");

export interface PackerOptions {
    webpackOptions?: webpack.Configuration;
    packageJson?: string | object | false;
    addDirectory?: string | string[];
    addZipFile?: string | string[];
    moduleWrapperOptions?: ModuleWrapperOptions;
}

export interface PackerResult {
    archive: NodeJS.ReadableStream;
    indexContents: string;
}

function getUrlEncodedQueryParameters(options: LoaderOptions) {
    return Object.keys(options)
        .filter(key => options[key])
        .map(key => `${key}=${encodeURIComponent(JSON.stringify(options[key]))}`)
        .join(`&`);
}

export async function packer(
    trampolineFactory: TrampolineFactory,
    functionModule: string,
    {
        webpackOptions = {},
        packageJson,
        addDirectory,
        addZipFile,
        moduleWrapperOptions = {},
        ...rest
    }: PackerOptions
): Promise<PackerResult> {
    const _exhaustiveCheck: Required<typeof rest> = {};
    info(`Running webpack`);
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
                info(`Adding file: ${entry}`);
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
            info(`Adding directory to archive: ${dir}`);
            if (!fs.existsSync(dir)) {
                warn(`Directory ${dir} not found`);
            }
            archive.directory(dir, false);
        }
    }

    async function processAddZips(archive: Archiver, zipFiles: string[]) {
        for (const zipFile of zipFiles) {
            await processZip(zipFile, (filename, contents) => {
                archive.append(contents, { name: filename });
            });
        }
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
        if (typeof addZipFile === "string") {
            addZipFile = [addZipFile];
        }
        if (addZipFile) {
            await processAddZips(archive, addZipFile);
        }
        archive.finalize();
        const indexContents = mfs.readFileSync("/index.js").toString();
        return { archive, indexContents };
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
        info(`webpack config: %O`, config);
        const compiler = webpack(config);
        compiler.outputFileSystem = mfs as any;
        return new Promise((resolve, reject) =>
            compiler.run((err, stats) => {
                if (err) {
                    reject(err);
                } else {
                    info(stats.toString());
                    info(`Memory filesystem: %O`, mfs.data);
                    resolve();
                }
            })
        );
    }

    const loader = `cloudify-loader?${getUrlEncodedQueryParameters({
        trampolineFactoryModule: trampolineFactory.filename,
        moduleWrapperOptions,
        functionModule
    })}!`;
    await runWebpack(loader, "index.js");
    return prepareZipArchive();
}

/**
 * @export
 * @param {NodeJS.ReadableStream | string} archive A zip archive as a stream or a filename
 * @param {(filename: string, contents: Readable) => void} processEntry Every
 * entry's contents must be consumed, otherwise the next entry won't be read.
 */
export async function processZip(
    archive: NodeJS.ReadableStream | string,
    processEntry: (filename: string, contents: Readable) => void
) {
    let zip: ZipFile;
    if (typeof archive === "string") {
        zip = await new Promise<ZipFile>((resolve, reject) =>
            yauzl.open(archive, { lazyEntries: true }, (err, zipfile) =>
                err ? reject(err) : resolve(zipfile)
            )
        );
    } else {
        const buf = await streamToBuffer(archive);
        zip = await new Promise<ZipFile>((resolve, reject) =>
            yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zipfile) =>
                err ? reject(err) : resolve(zipfile)
            )
        );
    }

    return new Promise<void>(async (resolve, reject) => {
        if (!zip) {
            reject(new Error("Error with zip file processing"));
            return;
        }
        zip.readEntry();
        zip.on("entry", (entry: yauzl.Entry) => {
            if (/\/$/.test(entry.fileName)) {
                zip.readEntry();
            } else {
                zip.openReadStream(entry, (err, readStream) => {
                    if (err) {
                        throw err;
                    }
                    readStream!.on("end", () => zip.readEntry());
                    processEntry(entry.fileName, readStream!);
                });
            }
        });
        zip.on("end", resolve);
    });
}

const mkdir = promisify(fs.mkdir);
const exists = promisify(fs.exists);

export async function unzipInDir(dir: string, archive: NodeJS.ReadableStream) {
    await mkdir(dir, { recursive: true });
    let total = 0;
    await processZip(archive, async (filename, contents) => {
        const destinationFilename = path.join(dir, filename);
        const { dir: outputDir } = path.parse(destinationFilename);
        if (!(await exists(outputDir))) {
            await mkdir(outputDir, { recursive: true });
        }
        const stream = fs.createWriteStream(destinationFilename, {
            mode: 0o700
        });
        contents.on("data", chunk => (total += chunk.length));
        contents.pipe(stream);
    });
    return total;
}

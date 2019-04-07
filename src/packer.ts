import { Archiver } from "archiver";
import { createWriteStream, mkdirp, pathExists, readFile } from "fs-extra";
import * as path from "path";
import { Readable } from "stream";
import * as webpack from "webpack";
import * as yauzl from "yauzl";
import { LoaderOptions } from "./loader";
import { log } from "./log";
import { commonDefaults, CommonOptions } from "./provider";
import { keysOf, streamToBuffer } from "./shared";
import { TrampolineFactory, WrapperOptionDefaults, WrapperOptions } from "./wrapper";

type ZipFile = yauzl.ZipFile;

import MemoryFileSystem = require("memory-fs");
import archiver = require("archiver");

export interface PackerResult {
    archive: NodeJS.ReadableStream;
}

function getUrlEncodedQueryParameters(options: LoaderOptions) {
    return keysOf(options)
        .filter(key => options[key])
        .map(key => `${key}=${encodeURIComponent(JSON.stringify(options[key]))}`)
        .join(`&`);
}

export async function packer(
    parentDir: string,
    trampolineFactory: TrampolineFactory,
    functionModule: string,
    userOptions: CommonOptions,
    userWrapperOptions: WrapperOptions
): Promise<PackerResult> {
    const options = { ...commonDefaults, ...userOptions };
    const wrapperOptions = { ...WrapperOptionDefaults, ...userWrapperOptions };
    let { webpackOptions, packageJson, addDirectory, addZipFile } = options;

    log.info(`Running webpack`);
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
                log.info(`Adding file: ${entry}`);
                archive.append((mfs as any).createReadStream(entry), {
                    name: path.relative(root, entry)
                });
            }
        }
        addEntry(root);
    }

    async function addPackageJson(packageJsonFile: string | object) {
        const parsedPackageJson =
            typeof packageJsonFile === "string"
                ? JSON.parse(
                      (await readFile(await resolvePath(packageJsonFile))).toString()
                  )
                : { ...packageJsonFile };
        parsedPackageJson.main = "index.js";
        mfs.writeFileSync(
            "/package.json",
            JSON.stringify(parsedPackageJson, undefined, 2)
        );
        return Object.keys(parsedPackageJson.dependencies || {});
    }

    async function resolvePath(pathName: string) {
        if (path.isAbsolute(pathName)) {
            return pathName;
        }
        const relativeDir = path.join(parentDir, pathName);
        if (await pathExists(relativeDir)) {
            return relativeDir;
        } else if (await pathExists(pathName)) {
            return pathName;
        }
        throw new Error(`Could not find "${pathName}" or "${relativeDir}"`);
    }

    async function processAddDirectories(archive: Archiver, directories: string[]) {
        for (const dir of directories) {
            archive.directory(await resolvePath(dir), false);
        }
    }

    async function processAddZips(archive: Archiver, zipFiles: string[]) {
        for (const zipFile of zipFiles) {
            await processZip(await resolvePath(zipFile), (filename, contents) => {
                archive.append(contents, { name: filename });
            });
        }
    }

    async function prepareZipArchive(): Promise<PackerResult> {
        const archive = archiver("zip", { zlib: { level: 8 } });
        archive.on("error", err => log.warn(err));
        archive.on("warning", err => log.warn(err));
        addToArchive("/", archive);
        if (typeof addDirectory === "string") {
            addDirectory = [addDirectory];
        }
        addDirectory && (await processAddDirectories(archive, addDirectory));
        if (typeof addZipFile === "string") {
            addZipFile = [addZipFile];
        }
        if (addZipFile) {
            await processAddZips(archive, addZipFile);
        }
        archive.finalize();
        return { archive };
    }

    const dependencies = (packageJson && (await addPackageJson(packageJson))) || [];
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
            resolveLoader: { modules: [__dirname, `${__dirname}/dist}`] },
            ...webpackOptions
        };
        config.externals = [
            ...externalsArray,
            ...dependencies,
            ...dependencies.map(d => new RegExp(`${d}/.*`))
        ];
        log.webpack(`webpack config: %O`, config);
        const compiler = webpack(config);
        compiler.outputFileSystem = mfs as any;
        return new Promise((resolve, reject) =>
            compiler.run((err, stats) => {
                if (err) {
                    reject(err);
                } else {
                    if (log.webpack.enabled) {
                        log.webpack(stats.toString());
                        log.webpack(`Memory filesystem: `);
                        for (const file of Object.keys(mfs.data)) {
                            log.webpack(`  ${file}: ${mfs.data[file].length}`);
                        }
                    }
                    resolve();
                }
            })
        );
    }

    const { childProcess } = options;
    const {
        wrapperVerbose: wrapperVerbose,
        childProcess: _onlyUsedForLocalProviderDirectWrapperInstantiation,
        childDir,
        childProcessMemoryLimitMb,
        childProcessTimeoutMs,
        wrapperLog: _onlyUsedForLocalProviderDirectWrapperInstantiation2,
        ...rest
    } = wrapperOptions;
    const _exhaustiveCheck2: Required<typeof rest> = {};
    const isVerbose = wrapperVerbose || log.provider.enabled;

    const loader = `loader?${getUrlEncodedQueryParameters({
        trampolineFactoryModule: trampolineFactory.filename,
        wrapperOptions: {
            wrapperVerbose: isVerbose,
            childProcess,
            childDir,
            childProcessMemoryLimitMb,
            childProcessTimeoutMs
        },
        functionModule
    })}!`;
    await runWebpack(loader, "index.js");
    return prepareZipArchive();
}

/**
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

export async function unzipInDir(dir: string, archive: NodeJS.ReadableStream) {
    await mkdirp(dir);
    let total = 0;
    await processZip(archive, async (filename, contents) => {
        const destinationFilename = path.join(dir, filename);
        const { dir: outputDir } = path.parse(destinationFilename);
        if (!(await pathExists(outputDir))) {
            await mkdirp(outputDir);
        }
        const stream = createWriteStream(destinationFilename, {
            mode: 0o700
        });
        contents.on("data", chunk => (total += chunk.length));
        contents.pipe(stream);
    });
    return total;
}

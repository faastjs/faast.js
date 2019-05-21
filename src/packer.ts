import { Archiver } from "archiver";
import { createWriteStream, ensureDir, mkdirp, pathExists, readFile } from "fs-extra";
import * as path from "path";
import { join } from "path";
import { PassThrough, Readable } from "stream";
import * as webpack from "webpack";
import * as yauzl from "yauzl";
import { FaastError } from "./error";
import { LoaderOptions } from "./loader";
import { log } from "./log";
import {
    commonDefaults,
    CommonOptions,
    AddDirectoryOption,
    AddZipFileOption
} from "./provider";
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
    userWrapperOptions: WrapperOptions,
    FunctionName: string
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
        throw new FaastError(`Could not find "${pathName}" or "${relativeDir}"`);
    }

    async function processAddDirectories(
        archive: Archiver,
        directories: (string | AddDirectoryOption)[]
    ) {
        for (const dir of directories) {
            let localDir: string;
            let remoteDir: string;
            if (typeof dir === "string") {
                localDir = dir;
                remoteDir = path.basename(dir);
            } else {
                localDir = dir.localDir;
                remoteDir = dir.remoteDir || path.basename(localDir);
            }
            archive.directory(await resolvePath(localDir), remoteDir);
        }
    }

    async function processAddZips(
        archive: Archiver,
        zipFiles: (string | AddZipFileOption)[]
    ) {
        for (const entry of zipFiles) {
            let localFile: string;
            let remoteDir: string;
            if (typeof entry === "string") {
                localFile = entry;
                remoteDir = path.basename(localFile, ".zip");
            } else {
                localFile = entry.localFile;
                remoteDir = entry.remoteDir || path.basename(localFile, ".zip");
            }
            await processZip(await resolvePath(localFile), (filename, contents, mode) => {
                const name = join(remoteDir, filename);
                archive.append(contents, { name, mode });
            });
        }
    }

    async function prepareZipArchive(): Promise<PackerResult> {
        const archive = archiver("zip", { zlib: { level: 8 } });
        archive.on("error", err => log.warn(err));
        archive.on("warning", err => log.warn(err));
        addToArchive("/", archive);
        if (!Array.isArray(addDirectory)) {
            addDirectory = [addDirectory];
        }
        addDirectory && (await processAddDirectories(archive, addDirectory));
        if (!Array.isArray(addZipFile)) {
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
            ...dependencies.map(d => new RegExp(`^${d}/.*`))
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

    const { childProcess, validateSerialization } = options;
    const {
        wrapperVerbose: wrapperVerbose,
        childProcess: _onlyUsedForLocalProviderDirectWrapperInstantiation,
        childDir,
        childProcessMemoryLimitMb,
        childProcessTimeoutMs,
        childProcessEnvironment: _onlyUsedForLocalProviderDirectWrapperInstantiation2,
        wrapperLog: _onlyUsedForLocalProviderDirectWrapperInstantiation3,
        validateSerialization: _ignoredInFavorOfCommonOptionsSetting,
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
            childProcessTimeoutMs,
            validateSerialization
        },
        functionModule
    })}!`;
    try {
        await runWebpack(loader, "index.js");
    } catch (err) {
        throw new FaastError(err, "failed running webpack");
    }
    try {
        let { archive } = await prepareZipArchive();
        const packageDir = process.env["FAAST_PACKAGE_DIR"];
        if (packageDir) {
            log.webpack(`FAAST_PACKAGE_DIR: ${packageDir}`);
            const packageFile = join(packageDir, FunctionName) + ".zip";
            await ensureDir(packageDir);
            const writeStream = createWriteStream(packageFile);
            const passThrough = archive.pipe(new PassThrough());
            archive = archive.pipe(new PassThrough());
            passThrough.pipe(writeStream);
            writeStream.on("close", () => {
                log.info(`Wrote ${packageFile}`);
            });
        }
        return { archive };
    } catch (err) {
        throw new FaastError(err, "failed creating zip archive");
    }
}

/**
 * @param {NodeJS.ReadableStream | string} archive A zip archive as a stream or a filename
 * @param {(filename: string, contents: Readable) => void} processEntry Every
 * entry's contents must be consumed, otherwise the next entry won't be read.
 */
export async function processZip(
    archive: NodeJS.ReadableStream | string,
    processEntry: (filename: string, contents: Readable, mode: number) => void
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

    return new Promise<void>((resolve, reject) => {
        zip.readEntry();
        zip.on("entry", (entry: yauzl.Entry) => {
            if (/\/$/.test(entry.fileName)) {
                zip.readEntry();
            } else {
                zip.openReadStream(entry, (err, readStream) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    readStream!.on("end", () => zip.readEntry());
                    processEntry(
                        entry.fileName,
                        readStream!,
                        entry.externalFileAttributes >>> 16
                    );
                });
            }
        });
        zip.on("end", resolve);
    });
}

export async function unzipInDir(dir: string, archive: NodeJS.ReadableStream) {
    await mkdirp(dir);
    let total = 0;
    await processZip(archive, async (filename, contents, mode) => {
        const destinationFilename = path.join(dir, filename);
        const { dir: outputDir } = path.parse(destinationFilename);
        if (!(await pathExists(outputDir))) {
            await mkdirp(outputDir);
        }
        const stream = createWriteStream(destinationFilename, { mode });
        contents.on("data", chunk => (total += chunk.length));
        contents.pipe(stream);
    });
    return total;
}

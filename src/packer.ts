import { Archiver } from "archiver";
import { createHash, Hash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as webpack from "webpack";
import { CloudifyLoaderOptions } from "./cloudify-loader";
import { log } from "./log";
import MemoryFileSystem = require("memory-fs");
import archiver = require("archiver");

export interface PackerOptions {
    webpackOptions?: webpack.Configuration;
    packageJson?: string | object;
}

export interface PackerResult {
    archive: Archiver;
    indexContents: string;
    hash: string;
}

function getUrlEncodedQueryParameters(options: CloudifyLoaderOptions) {
    return Object.keys(options)
        .filter(key => options[key])
        .map(key => `${key}=${encodeURIComponent(options[key])}`)
        .join(`&`);
}

export function packer(
    loaderOptions: CloudifyLoaderOptions,
    { webpackOptions = {}, packageJson, ...otherPackerOptions }: PackerOptions
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

    function addToArchive(
        mfs: MemoryFileSystem,
        entry: string,
        archive: Archiver,
        hasher: Hash
    ) {
        const stat = mfs.statSync(entry);
        if (stat.isDirectory()) {
            for (const subEntry of mfs.readdirSync(entry)) {
                const subEntryPath = path.join(entry, subEntry);
                addToArchive(mfs, subEntryPath, archive, hasher);
            }
        } else if (stat.isFile()) {
            archive.append((mfs as any).createReadStream(entry), {
                name: entry
            });
            hasher.update(entry);
            hasher.update(mfs.readFileSync(entry));
        }
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

    function zipAndHash(mfs: MemoryFileSystem): PackerResult {
        const archive = archiver("zip", { zlib: { level: 9 } });
        const hasher = createHash("sha256");
        addToArchive(mfs, "/", archive, hasher);
        const hash = hasher.digest("hex");
        archive.finalize();
        const indexContents = mfs.readFileSync("/index.js").toString();
        return { archive, hash, indexContents };
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
                resolve(zipAndHash(mfs));
            }
        });
    });
}

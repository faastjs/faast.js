import { Archiver } from "archiver";
import { Hash, createHash } from "crypto";
import * as fs from "fs";
import humanStringify from "human-stringify";
import * as path from "path";
import * as webpack from "webpack";
import { CloudifyLoaderOptions } from "./cloudify-loader";
import { log } from "./log";
import MemoryFileSystem = require("memory-fs");
import archiver = require("archiver");
import nodeExternals = require("webpack-node-externals");

export interface PackerOptions extends CloudifyLoaderOptions {
    webpackOptions?: webpack.Configuration;
    packageBundling?: "usePackageJson" | "bundleNodeModules";
}

export interface PackerResult {
    archive: Archiver;
    hash: string;
}

function getUrlEncodedQueryParameters(options: CloudifyLoaderOptions) {
    return Object.keys(options)
        .filter(key => options[key])
        .map(key => `${key}=${encodeURIComponent(options[key])}`)
        .join(`&`);
}

export function packer({
    trampolineModule,
    functionModule,
    webpackOptions = {},
    packageBundling = "bundleNodeModules"
}: PackerOptions): Promise<PackerResult> {
    log(`Running webpack`);
    let { externals = [], ...rest } = webpackOptions;
    externals = Array.isArray(externals) ? externals : [externals];
    const loaderOptions = {
        trampolineModule,
        functionModule
    };
    const loader = `cloudify-loader?${getUrlEncodedQueryParameters(loaderOptions)}!`;
    const config: webpack.Configuration = {
        entry: loader,
        mode: "development",
        output: {
            path: "/",
            filename: "index.js",
            libraryTarget: "commonjs2"
        },
        externals: [
            packageBundling === "usePackageJson" ? nodeExternals() : {},
            ...externals
        ],
        target: "node",
        resolveLoader: { modules: [__dirname, `${__dirname}/build}`] },
        ...rest
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

    function addPackageJson(mfs: MemoryFileSystem) {
        if (packageBundling === "usePackageJson") {
            const packageJson = JSON.parse(fs.readFileSync("package.json").toString());
            packageJson.main = "index.js";
            mfs.writeFileSync("/package.json", JSON.stringify(packageJson, undefined, 2));
        }
    }

    function zipAndHash(mfs: MemoryFileSystem): PackerResult {
        const archive = archiver("zip", { zlib: { level: 9 } });
        const hasher = createHash("sha256");
        addToArchive(mfs, "/", archive, hasher);
        const hash = hasher.digest("hex");
        archive.finalize();
        return { archive, hash };
    }

    return new Promise<PackerResult>((resolve, reject) => {
        const mfs = new MemoryFileSystem();
        addPackageJson(mfs);
        const compiler = webpack(config);

        compiler.outputFileSystem = mfs;
        compiler.run((err, stats) => {
            if (err) {
                reject(err);
            } else {
                log(stats.toString());
                log(`Memory filesystem: ${humanStringify(mfs.data)}`);
                resolve(zipAndHash(mfs));
            }
        });
    });
}

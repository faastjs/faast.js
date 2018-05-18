import { Archiver } from "archiver";
import { Hash, createHash } from "crypto";
import { Request, Response } from "express";
import * as fs from "fs";
import humanStringify from "human-stringify";
import * as path from "path";
import * as webpack from "webpack";
import { log } from "./log";
import MemoryFileSystem = require("memory-fs");
import archiver = require("archiver");
import nodeExternals = require("webpack-node-externals");

export interface FunctionCall {
    name: string;
    args: any[];
}

export interface FunctionReturn {
    type: "returned" | "error";
    message?: string;
    value?: any;
}

export type AnyFunction = (...args: any[]) => any;

const funcs: { [func: string]: AnyFunction } = {};

export function registerFunction(fn: (...args: any[]) => any, name?: string) {
    name = name || fn.name;
    if (!name) {
        throw new Error("Could not register function without name");
    }
    funcs[name] = fn;
}

export async function trampoline(request: Request, response: Response) {
    try {
        const call = request.body as FunctionCall;
        if (!call) {
            throw new Error("Invalid function call request");
        }

        const func = funcs[call.name];
        if (!func) {
            throw new Error(`Function named "${call.name}" not found`);
        }

        if (!call.args || !call.args.length) {
            throw new Error("Invalid arguments to function call");
        }

        const rv = await func.apply(undefined, call.args);

        response.send({
            type: "returned",
            value: rv
        } as FunctionReturn);
    } catch (err) {
        response.send({
            type: "error",
            message: err.stack
        } as FunctionReturn);
    }
}

export interface PackerOptions {
    webpackOptions?: webpack.Configuration;
    packageBundling?: "usePackageJson" | "bundleNodeModules";
}

const prefix = "/dist";

interface PackerResult {
    archive: Archiver;
    hash: string;
}

export async function packer(
    entry: string,
    { webpackOptions = {}, packageBundling = "usePackageJson" }: PackerOptions = {}
): Promise<PackerResult> {
    log(`Running webpack`);
    const defaultWebpackConfig: webpack.Configuration = {
        entry: `cloudify-loader?entry=${entry}!`,
        mode: "development",
        output: {
            path: "/",
            filename: "index.js",
            libraryTarget: "commonjs2"
        },
        externals: [packageBundling === "usePackageJson" ? nodeExternals() : ""],
        target: "node",
        resolveLoader: { modules: [__dirname] }
    };

    const config = Object.assign({}, defaultWebpackConfig, webpackOptions);

    function addToArchive(
        fs: MemoryFileSystem,
        entry: string,
        archive: Archiver,
        hasher: Hash
    ) {
        const stat = fs.statSync(entry);
        if (stat.isDirectory()) {
            for (const subEntry of fs.readdirSync(entry)) {
                const subEntryPath = path.join(entry, subEntry);
                addToArchive(fs, subEntryPath, archive, hasher);
            }
        } else if (stat.isFile()) {
            archive.append((fs as any).createReadStream(entry), {
                name: entry
            });
            hasher.update(entry);
            hasher.update(fs.readFileSync(entry));
        }
    }

    function addPackageJson(mfs: MemoryFileSystem) {
        if (packageBundling === "usePackageJson") {
            const packageJson = JSON.parse(fs.readFileSync("package.json").toString());
            packageJson["main"] = "index.js";
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

let fname = __filename; // defeat constant propagation; __filename is different in webpack bundles.
if (fname === "/index.js") {
    log(`Execution context within webpack bundle!`);
}

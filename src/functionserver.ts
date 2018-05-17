import { Archiver } from "archiver";
import { Hash, createHash } from "crypto";
import { Request, Response } from "express";
import * as fs from "fs";
import humanStringify from "human-stringify";
import * as path from "path";
import * as webpack from "webpack";
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
        console.log(`BODY: ${humanStringify(call)}`);
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
    verbose?: boolean;

    webpackOptions?: webpack.Configuration;
}

const prefix = "/dist";

interface PackerResult {
    archive: Archiver;
    hash: string;
}

export async function packer(
    entry: string,
    { verbose = false, webpackOptions = {} }: PackerOptions = {}
): Promise<PackerResult> {
    verbose && console.log(`Running webpack`);
    const defaultWebpackConfig: webpack.Configuration = {
        entry,
        mode: verbose ? "development" : "production",
        output: {
            path: "/",
            filename: "index.js",
            libraryTarget: "commonjs2"
        },
        externals: [nodeExternals()],
        target: "node"
    };

    const config = Object.assign({}, defaultWebpackConfig, webpackOptions);

    const compiler = webpack(config);

    const mfs = new MemoryFileSystem();
    compiler.outputFileSystem = mfs;

    function addToArchive(entry: string, archive: Archiver, hasher: Hash) {
        const stat = mfs.statSync(entry);
        if (stat.isDirectory()) {
            for (const subEntry of mfs.readdirSync(entry)) {
                const subEntryPath = path.join(entry, subEntry);
                addToArchive(subEntryPath, archive, hasher);
            }
        } else if (stat.isFile()) {
            archive.append((mfs as any).createReadStream(entry), {
                name: entry
            });
            hasher.update(entry);
            hasher.update(mfs.readFileSync(entry));
        }
    }

    return new Promise<PackerResult>((resolve, reject) => {
        compiler.run((err, stats) => {
            if (err) {
                reject(err);
            } else {
                const archive = archiver("zip", { zlib: { level: 9 } });
                const packageJson = JSON.parse(
                    fs.readFileSync("package.json").toString()
                );
                packageJson["main"] = "index.js";
                mfs.writeFileSync(
                    "/package.json",
                    JSON.stringify(packageJson, undefined, 2)
                );
                const hasher = createHash("sha256");
                addToArchive("/", archive, hasher);
                const hash = hasher.digest("hex");
                archive.finalize();
                if (verbose) {
                    console.log(stats.toString());
                    console.log(`Checking memory filesystem`);
                    console.log(`${humanStringify(mfs.data)}`);
                }
                resolve({ archive, hash });
            }
        });
    });
}

let fname = __filename; // defeat constant propagation; __filename is different in webpack bundles.
if (fname === "/index.js") {
    console.log(`Execution context within webpack bundle!`);
}

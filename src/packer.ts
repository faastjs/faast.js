import { Archiver } from "archiver";
import * as fs from "fs";
import humanStringify from "human-stringify";
import * as path from "path";
import * as webpack from "webpack";
import MemoryFileSystem = require("memory-fs");
import archiver = require("archiver");
import nodeExternals = require("webpack-node-externals");

export interface PackerOptions {
    verbose?: boolean;
    webpackOptions?: webpack.Configuration;
}

export async function packer(
    file: string,
    { verbose = false, webpackOptions = {} }: PackerOptions = {}
) {
    verbose && console.log(`Running webpack`);
    const defaultWebpackConfig: webpack.Configuration = {
        entry: file,
        mode: verbose ? "development" : "production",
        output: {
            path: `/`,
            library: "trampoline",
            libraryTarget: "commonjs2",
            filename: "index.js"
        },
        externals: [nodeExternals()],
        target: "node"
    };

    const config = Object.assign({}, defaultWebpackConfig, webpackOptions);

    const compiler = webpack(config);

    const mfs = new MemoryFileSystem();
    compiler.outputFileSystem = mfs;

    function addToArchive(entry: string, archive: Archiver) {
        const stat = mfs.statSync(entry);
        if (stat.isDirectory()) {
            for (const subEntry of mfs.readdirSync(entry)) {
                const subEntryPath = path.join(entry, subEntry);
                addToArchive(subEntryPath, archive);
            }
        } else if (stat.isFile()) {
            archive.append((mfs as any).createReadStream(entry), {
                name: entry
            });
        }
    }

    return new Promise<Archiver>((resolve, reject) => {
        compiler.run((err, stats) => {
            if (err) {
                reject(err);
            } else {
                const archive = archiver("zip", { zlib: { level: 9 } });
                addToArchive("/", archive);
                archive.append(fs.createReadStream("package.json"), {
                    name: "/package.json"
                });
                archive.finalize();
                resolve(archive);
                if (verbose) {
                    console.log(stats.toString());
                    console.log(`Checking memory filesystem`);
                    console.log(`${humanStringify(mfs.data)}`);
                }
            }
        });
    });
}

async function test() {
    const output = fs.createWriteStream("dist.zip");
    const archive = await packer(__filename, { verbose: true });
    archive.pipe(output);
}

// test();

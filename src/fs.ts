import * as fs from "fs";
import { promisify } from "util";
import { join, dirname } from "path";
import { gte } from "semver";

export const rmdir = promisify(fs.rmdir);
export const stat = promisify(fs.stat);
export const readdir = promisify(fs.readdir);
export const exists = promisify(fs.exists);
export const unlink = promisify(fs.unlink);
export const readFile = promisify(fs.readFile);
export const writeFile = promisify(fs.writeFile);
export const createReadStream = fs.createReadStream;
export const createWriteStream = fs.createWriteStream;

export async function rmrf(dir: string) {
    const contents = await readdir(dir);
    for (const name of contents) {
        const dirEntry = join(dir, name);
        const statResult = await stat(dirEntry);
        if (statResult.isFile()) {
            await unlink(dirEntry);
        } else if (statResult.isDirectory()) {
            await rmrf(dirEntry);
        } else {
            throw new Error(`Could not remove '${dirEntry}'`);
        }
    }
    await rmdir(dir);
}

const mkdirPromise = promisify(fs.mkdir);
export async function mkdir(dir: string, options?: fs.MakeDirectoryOptions) {
    if (await exists(dir).catch(_ => false)) {
        return;
    }
    if (gte(process.version, "10.12.0") || !options || !options.recursive) {
        return mkdirPromise(dir, options);
    }

    await mkdir(dirname(dir), options);
    await mkdirPromise(dir);
}

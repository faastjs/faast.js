import * as fs from "fs";
import { promisify } from "util";
import { join } from "path";

export const mkdir = promisify(fs.mkdir);
export const rmdir = promisify(fs.rmdir);
export const stat = promisify(fs.stat);
export const readdir = promisify(fs.readdir);
export const exists = promisify(fs.exists);
export const unlink = promisify(fs.unlink);
export const readFile = promisify(fs.readFile);
export const writeFile = promisify(fs.writeFile);

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

import { ensureDir, remove, pathExists } from "fs-extra";

export async function runFsExtra() {
    await ensureDir("./exDir/0/1/2");
    const rv = await pathExists("./exDir/0/1/2");
    await remove("./exDir");
    return rv;
}

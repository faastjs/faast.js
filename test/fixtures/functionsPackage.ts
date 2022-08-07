import fs from "fs-extra";

export function isDir(dir: string) {
    return fs.stat(dir).then(s => s.isDirectory());
}

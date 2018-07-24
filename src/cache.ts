import * as fs from "fs";
import { homedir } from "os";
import { join } from "path";
import { promisify } from "util";
import { Readable } from "stream";
import * as rimraf from "rimraf";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const rmdir = promisify(rimraf);
const stat = promisify(fs.stat);

export class LocalCache {
    readonly dir: string;

    constructor(
        readonly provider: string,
        readonly expiration: number = 24 * 3600 * 1000
    ) {
        const cacheDir = join(homedir(), ".cloudify");
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, 0o700);
        }
        const providerDir = join(cacheDir, provider);
        if (!fs.existsSync(providerDir)) {
            fs.mkdirSync(providerDir, 0o700);
        }
        this.dir = join(homedir(), ".cloudify", this.provider);
    }

    async get(key: string) {
        const entry = join(this.dir, key);
        const statEntry = await stat(entry).catch(_ => {});
        if (statEntry) {
            if (Date.now() - statEntry.mtimeMs > this.expiration) {
                return undefined;
            }
            return readFile(entry).catch(_ => {});
        }
        return undefined;
    }

    set(key: string, value: Buffer | string | Uint8Array | Readable | Blob) {
        const entry = join(this.dir, key);
        return writeFile(entry, value, { mode: 0o600, encoding: "binary" });
    }

    entries() {
        return fs.readdirSync(this.dir);
    }

    clear() {
        return rmdir(`${this.dir}/*`);
    }
}

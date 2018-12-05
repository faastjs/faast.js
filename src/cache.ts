import { homedir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { exists, mkdir, readdir, readFile, rmrf, stat, writeFile } from "./fs";

/**
 * A simple persistent key-value store. Entries can be expired, but are not
 * actually deleted individually. The entire cache can be deleted at once. Hence
 * this cache is useful for storing results that are expensive to compute but do
 * not change too often (e.g. the node_modules folder from an 'npm install'
 * where 'package.json' is not expected to change too often)
 *
 * @export
 * @class LocalCache
 */
export class LocalCache {
    static async create(
        dirRelativeToHomeDir: string,
        expiration: number = 24 * 3600 * 1000
    ) {
        const rv = new LocalCache(dirRelativeToHomeDir, expiration);
        if (!(await exists(rv.dir))) {
            await mkdir(rv.dir, { mode: 0o700, recursive: true });
        }
        return rv;
    }

    readonly dir: string;

    /**
     * @param {string} dirRelativeToHomeDir The directory under the user's home
     * directory that will be used to store cached values. The directory will be
     * created if it doesn't exist.
     * @param {number} [expiration=24 * 3600 * 1000] The age (in seconds) after
     * which a cached entry is invalid
     */
    protected constructor(
        readonly dirRelativeToHomeDir: string,
        readonly expiration: number
    ) {
        this.dir = join(homedir(), dirRelativeToHomeDir);
    }

    /**
     * Retrieves the value previously set for the given key, or undefined if the
     * key is not found.
     */
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

    /**
     * Retrieve all keys stored in the cache, including expired entries.
     */
    entries() {
        return readdir(this.dir);
    }

    /**
     * Deletes all cached entries from disk.
     */
    async clear() {
        await rmrf(`${this.dir}`);
        await mkdir(this.dir, { mode: 0o700, recursive: true });
    }
}

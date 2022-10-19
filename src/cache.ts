import {
    mkdirp,
    pathExists,
    readdir,
    readFile,
    remove,
    rename,
    stat,
    writeFile
} from "fs-extra";
import { homedir } from "os";
import { join, sep } from "path";
import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";

interface Blob {}

/**
 * A simple persistent key-value store. Used to implement {@link Limits.cache}
 * for {@link throttle}.
 * @remarks
 * Entries can be expired, but are not actually deleted individually. The entire
 * cache can be deleted at once. Hence this cache is useful for storing results
 * that are expensive to compute but do not change too often (e.g. the
 * node_modules folder from an 'npm install' where 'package.json' is not
 * expected to change too often).
 *
 * By default faast.js will use the directory `~/.faastjs` as a local cache to
 * store data such as pricing retrieved from cloud APIs, and garbage collection
 * information. This directory can be safely deleted if no faast.js instances
 * are running.
 * @public
 */
export class PersistentCache {
    private initialized: Promise<void>;

    private async initialize(dir: string) {
        if (!(await pathExists(dir))) {
            await mkdirp(dir);
        }
    }

    /**
     * The directory on disk where cached values are stored.
     */
    readonly dir: string;

    /**
     * Construct a new persistent cache, typically used with {@link Limits} as
     * part of the arguments to {@link throttle}.
     * @param dirRelativeToHomeDir - The directory under the user's home
     * directory that will be used to store cached values. The directory will be
     * created if it doesn't exist.
     * @param expiration - The age (in ms) after which a cached entry is
     * invalid. Default: `24*3600*1000` (1 day).
     */
    constructor(
        /**
         * The directory under the user's home directory that will be used to
         * store cached values. The directory will be created if it doesn't
         * exist.
         */
        readonly dirRelativeToHomeDir: string,
        /**
         * The age (in ms) after which a cached entry is invalid. Default:
         * `24*3600*1000` (1 day).
         */
        readonly expiration: number = 24 * 3600 * 1000
    ) {
        this.dir = join(homedir(), dirRelativeToHomeDir);
        this.initialized = this.initialize(this.dir);
    }

    /**
     * Retrieves the value previously set for the given key, or undefined if the
     * key is not found.
     */
    async get(key: string) {
        // return undefined if key is an unsafe path
        if (key.includes('\\') || key.includes('/') || key === '..' || key === '.') {
            return undefined;
        }
        await this.initialized;
        const entry = join(this.dir, key);
        const statEntry = await stat(entry).catch(_ => {});
        if (statEntry) {
            if (Date.now() - statEntry.mtimeMs > this.expiration) {
                return undefined;
            }
            return readFile(entry).catch(_ => undefined);
        }
        return undefined;
    }

    /**
     * Set the cache key to the given value.
     * @returns a Promise that resolves when the cache entry has been persisted.
     */
    async set(key: string, value: Buffer | string | Uint8Array | Readable | Blob) {
        // return undefined if key is an unsafe path
        if (key.includes('\\') || key.includes('/') || key === '..' || key === '.') {
            throw Error('Please make sure that `key` is a single path component.')
        }
        await this.initialized;
        const entry = join(this.dir, key);
        const tmpEntry = join(this.dir, uuidv4());
        await writeFile(tmpEntry, value, { mode: 0o600, encoding: "binary" });
        await rename(tmpEntry, entry);
    }

    /**
     * Retrieve all keys stored in the cache, including expired entries.
     */
    entries() {
        return readdir(this.dir);
    }

    /**
     * Deletes all cached entries from disk.
     * @param leaveEmptyDir - If true, leave the cache directory in place after
     * deleting its contents. If false, the cache directory will be removed.
     * Default: `true`.
     */
    async clear({ leaveEmptyDir = true } = {}) {
        await this.initialized;

        await remove(this.dir);

        if (leaveEmptyDir) {
            await mkdirp(this.dir);
        }
    }
}

const days = 24 * 3600 * 1000;

export const caches = {
    awsPrices: new PersistentCache(".faastjs/aws/pricing", 1 * days),
    googlePrices: new PersistentCache(".faastjs/google/pricing", 1 * days),
    awsGc: new PersistentCache(".faastjs/aws/gc", 7 * days)
};

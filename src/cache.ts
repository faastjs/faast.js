import { homedir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { exists, mkdir, readdir, readFile, rmrf, stat, writeFile } from "./fs";
import { info } from "./log";

/**
 * A simple persistent key-value store. Entries can be expired, but are not
 * actually deleted individually. The entire cache can be deleted at once. Hence
 * this cache is useful for storing results that are expensive to compute but do
 * not change too often (e.g. the node_modules folder from an 'npm install'
 * where 'package.json' is not expected to change too often)
 *
 * @export
 * @class PersistentCache
 */
export class PersistentCache {
    initialized: Promise<void>;

    protected async initialize(dir: string) {
        info(`persistent cache initialize`);
        try {
            if (!(await exists(dir))) {
                try {
                    await mkdir(dir, { mode: 0o700, recursive: true });
                    const e = await exists(dir);
                    info(`persistent cache initialized dir: ${dir}, exists? ${e}`);
                    const contents = await readdir(dir);
                    info(`dir ${dir} contents:\n  ${contents.join("\n  ")}`);
                } catch (err) {
                    if (err.code !== "EEXIST") {
                        throw err;
                    }
                }
            }
        } catch (err) {
            info(
                `persistent cache inititializetion error for ${dir}: `,
                err.stack || err.message
            );
        } finally {
            info(`persistent cache init done: ${dir}`);
        }
    }

    readonly dir: string;

    /**
     * @param {string} dirRelativeToHomeDir The directory under the user's home
     * directory that will be used to store cached values. The directory will be
     * created if it doesn't exist.
     * @param {number} [expiration=24 * 3600 * 1000] The age (in seconds) after
     * which a cached entry is invalid
     */
    constructor(
        readonly dirRelativeToHomeDir: string,
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
        info(`persistent cache get`);
        try {
            await this.initialized;
            const entry = join(this.dir, key);
            const statEntry = await stat(entry).catch(_ => {});
            if (statEntry) {
                if (Date.now() - statEntry.mtimeMs > this.expiration) {
                    return undefined;
                }
                return readFile(entry).catch(_ => {});
            }
            return undefined;
        } catch (err) {
            info(`persistent cache get error: ${err.stack || err.message}`);
        } finally {
            info(`persistent cache get done.`);
        }
    }

    async set(key: string, value: Buffer | string | Uint8Array | Readable | Blob) {
        info(`persistent cache set`);
        try {
            await this.initialized;
            const entry = join(this.dir, key);
            info(`persistent cache writing entry: ${entry}`);
            await writeFile(entry, value, { mode: 0o600, encoding: "binary" });
        } catch (err) {
            info(`persistent cache set error: ${err.stack || err.message}`);
        } finally {
            info(`persistent cache set done.`);
        }
    }

    /**
     * Retrieve all keys stored in the cache, including expired entries.
     */
    entries() {
        info(`persistent cache entries`);
        try {
            return readdir(this.dir);
        } catch (err) {
            info(`persistent cache entries error: ${err.stack || err.message}`);
            throw err;
        } finally {
            info(`persistent cache entries done.`);
        }
    }

    /**
     * Deletes all cached entries from disk.
     */
    async clear({ leaveEmptyDir = true } = {}) {
        info(`persistent cache clear`);
        try {
            await this.initialized;

            await rmrf(this.dir);

            if (leaveEmptyDir) {
                await mkdir(this.dir, { mode: 0o700, recursive: true });
            }
        } catch (err) {
            info(`persistent cache clear error: ${err.stack || err.message}`);
        } finally {
            info(`persistent cache clear done.`);
        }
    }
}

const days = 24 * 3600 * 1000;

export const caches = {
    awsPackage: new PersistentCache(".faast/aws/packages", 7 * days),
    awsPrices: new PersistentCache(".faast/aws/pricing", 1 * days),
    googlePrices: new PersistentCache(".faast/google/pricing", 1 * days)
};

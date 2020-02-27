import anytest, { TestInterface } from "ava";
import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { PersistentCache } from "../src/cache";
import { sleep } from "./fixtures/functions";

const test = anytest as TestInterface<{ cache: PersistentCache }>;

test.beforeEach(t => {
    const nonce = uuidv4();
    t.context.cache = new PersistentCache(`.faast/test/${nonce}`);
});

test.afterEach.always(async t => {
    await t.context.cache.clear({ leaveEmptyDir: false });
});

test("persistent cache directory respects relative path", t => {
    t.regex(t.context.cache.dir, /test/);
});

test("persistent cache handles missing cache entries", async t => {
    t.falsy(await t.context.cache.get("foo"));
});

test("persistent cache can set and get cache entries", async t => {
    try {
        const { cache } = t.context;
        try {
            await cache.set("foo", "bar");
        } catch (err) {
            console.log(`persistent cache set error: ${err}`);
            throw err;
        }
        try {
            const result = await cache.get("foo");
            t.is(result?.toString(), "bar");
        } catch (err) {
            console.log(`persistent cache get error ${err}`);
            throw err;
        }
    } catch (err) {
        console.log(`persistent cache test error: ${err.stack || err.message}`);
    }
});

test("persistent cache ignores entries after they expire", async t => {
    const cache2 = new PersistentCache(t.context.cache.dirRelativeToHomeDir, 100);
    await cache2.set("foo", "bar");
    let result = await cache2.get("foo");
    t.is(result?.toString(), "bar");
    await sleep(101);
    result = await cache2.get("foo");
    t.falsy(result?.toString());
});

test("persistent cache keys can be sha256 hashes", async t => {
    const hasher = createHash("sha256");
    hasher.update("input");
    const hash = hasher.digest("hex");
    const { cache } = t.context;
    await cache.set(hash, "value");
    const result = await cache.get(hash);
    t.is(result?.toString(), "value");
});

test("persistent cache value can be a Buffer", async t => {
    const { cache } = t.context;
    await cache.set("key", Buffer.from("value"));
    const result = await cache.get("key");
    t.is(result?.toString(), "value");
});

test("persistent cache values are persistent", async t => {
    const { cache } = t.context;
    await cache.set("persistentKey", "persistent");
    const cache2 = new PersistentCache(cache.dirRelativeToHomeDir);
    const result2 = await cache2.get("persistentKey");
    t.is(result2?.toString(), "persistent");
});

test("persistent cache clearing", async t => {
    const { cache } = t.context;
    await cache.set("key", "value");
    const value = await cache.get("key");
    t.is(value?.toString(), "value");
    await cache.clear();
    t.falsy(await cache.get("key"));
});

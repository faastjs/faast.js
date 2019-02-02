import { LocalCache } from "../src/cache";
import { sleep } from "./functions";
import { createHash } from "crypto";
import * as uuidv4 from "uuid/v4";
import anytest, { TestInterface } from "ava";

const test = anytest as TestInterface<{ cache: LocalCache }>;

test.beforeEach(t => {
    const nonce = uuidv4();
    t.context.cache = new LocalCache(`.faast/test/${nonce}`);
});

test.afterEach.always(async t => {
    await t.context.cache.clear({ leaveEmptyDir: false });
});

test("local cache directory respects relative path", t => {
    t.regex(t.context.cache.dir, /test/);
});

test("local cache handles missing cache entries", async t => {
    t.falsy(await t.context.cache.get("foo"));
});

test("local cache can set and get cache entries", async t => {
    const { cache } = t.context;
    await cache.set("foo", "bar");
    const result = await cache.get("foo");
    t.is(result && result.toString(), "bar");
});

test("local cache ignores entries after they expire", async t => {
    const cache2 = new LocalCache(t.context.cache.dirRelativeToHomeDir, 100);
    await cache2.set("foo", "bar");
    let result = await cache2.get("foo");
    t.is(result && result.toString(), "bar");
    await sleep(101);
    result = await cache2.get("foo");
    t.falsy(result && result.toString());
});

test("local cache keys can be sha256 hashes", async t => {
    const hasher = createHash("sha256");
    hasher.update("input");
    const hash = hasher.digest("hex");
    const { cache } = t.context;
    await cache.set(hash, "value");
    const result = await cache.get(hash);
    t.is(result && result.toString(), "value");
});

test("local cache value can be a Buffer", async t => {
    const { cache } = t.context;
    await cache.set("key", Buffer.from("value"));
    const result = await cache.get("key");
    t.is(result && result.toString(), "value");
});

test("local cache values are persistent", async t => {
    const { cache } = t.context;
    await cache.set("persistentKey", "persistent");
    const cache2 = new LocalCache(cache.dirRelativeToHomeDir);
    const result2 = await cache2.get("persistentKey");
    t.is(result2 && result2.toString(), "persistent");
});

test("local cache clearing", async t => {
    const { cache } = t.context;
    await cache.set("key", "value");
    const value = await cache.get("key");
    t.is(value && value.toString(), "value");
    await cache.clear();
    t.falsy(await cache.get("key"));
});

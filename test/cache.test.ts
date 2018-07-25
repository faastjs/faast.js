import { LocalCache } from "../src/cache";
import { delay } from "./functions";
import { createHash } from "crypto";

let cache: LocalCache;

beforeEach(async () => {
    cache = new LocalCache("test");
    await cache.clear();
});

test("local cache directory is provider-specific", async () => {
    expect(cache.dir).toMatch(/test/);
});

test("handles missing cache entries", async () => {
    expect(await cache.get("foo")).toBeUndefined();
});

test("can set and get cache entries", async () => {
    await cache.set("foo", "bar");
    const result = await cache.get("foo");
    expect(result && result.toString()).toBe("bar");
});

test("cache expiration", async () => {
    const cache2 = new LocalCache("test", 100);
    await cache2.set("foo", "bar");
    let result = await cache2.get("foo");
    expect(result && result.toString()).toBeDefined();
    await delay(101);
    result = await cache2.get("foo");
    expect(result && result.toString()).toBeUndefined();
});

test("keys can be sha256 hashes", async () => {
    const hasher = createHash("sha256");
    hasher.update("input");
    const hash = hasher.digest("hex");
    await cache.set(hash, "value");
    const result = await cache.get(hash);
    expect(result && result.toString()).toBe("value");
});

test("cache value can be a Buffer", async () => {
    await cache.set("key", Buffer.from("value"));
    const result = await cache.get("key");
    expect(result && result.toString()).toBe("value");
});

test("cache values are persistent", async () => {
    await cache.set("persistentKey", "persistent");
    const cache2 = new LocalCache("test");
    const result2 = await cache2.get("persistentKey");
    expect(result2 && result2.toString()).toBe("persistent");
});

afterAll(async () => {
    await cache.clear();
});

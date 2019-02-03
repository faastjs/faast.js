import { tmpdir } from "os";
import * as path from "path";
import * as uuidv4 from "uuid/v4";
import { createWriteStream, exists, mkdir, rmrf } from "../src/fs";
import test from "ava";

test(`fs module rmrf deletes directory recursively`, async t => {
    const tmp = path.join(tmpdir(), uuidv4());
    const subdir = path.join(tmp, "subdir");
    await mkdir(tmp);
    await mkdir(subdir);
    const file = path.join(subdir, "file.txt");
    const stream = createWriteStream(file);
    await new Promise((resolve, reject) =>
        stream.write("hello", err => (err ? reject(err) : resolve()))
    );
    stream.close();
    t.true(await exists(file));
    t.true(await exists(subdir));
    t.true(await exists(tmp));
    await rmrf(tmp);
    t.false(await exists(file));
    t.false(await exists(subdir));
    t.false(await exists(tmp));
});

test("fs module mkdir succeeds on directories that already exist", async t => {
    const dir = path.join(tmpdir(), "faast-test");
    t.falsy(await mkdir(dir));
    t.falsy(await mkdir(dir));
    t.true(await exists(dir));
    await rmrf(dir);
});

test("fs module mkdir recursive", async t => {
    const testDir = path.join(tmpdir(), "faast-test2");
    const dir = path.join(testDir, uuidv4(), uuidv4());
    await mkdir(dir, { recursive: true });
    t.true(await exists(dir));
    await rmrf(testDir);
});

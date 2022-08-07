import test from "ava";
import { createWriteStream, mkdir, mkdirp, pathExists, remove } from "fs-extra";
import { tmpdir } from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";

/**
 * The point of this file is to ensure that whatever filesystem library is used,
 * it has required functionality for faast.js. Originally we had a custom fs
 * module, which was later replaced by fs-extra. Now these tests ensure that
 * fs-extra behaves as expected.
 */

test(`fs module rmrf deletes directory recursively`, async t => {
    const tmp = path.join(tmpdir(), uuidv4());
    const subdir = path.join(tmp, "subdir");
    await mkdir(tmp);
    await mkdir(subdir);
    const file = path.join(subdir, "file.txt");
    const stream = createWriteStream(file);
    await new Promise<void>((resolve, reject) =>
        stream.write("hello", err => (err ? reject(err) : resolve()))
    );
    stream.close();
    t.true(await pathExists(file));
    t.true(await pathExists(subdir));
    t.true(await pathExists(tmp));
    await remove(tmp);
    t.false(await pathExists(file));
    t.false(await pathExists(subdir));
    t.false(await pathExists(tmp));
});

test("fs module mkdir succeeds on directories that already exist", async t => {
    const dir = path.join(tmpdir(), "faast-test");
    await t.notThrowsAsync(mkdirp(dir));
    await t.notThrowsAsync(mkdirp(dir));
    t.true(await pathExists(dir));
    await remove(dir);
});

test("fs module mkdir recursive", async t => {
    const testDir = path.join(tmpdir(), "faast-test2");
    const dir = path.join(testDir, uuidv4(), uuidv4());
    await mkdirp(dir);
    t.true(await pathExists(dir));
    await remove(testDir);
});

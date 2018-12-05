import * as path from "path";
import { tmpdir } from "os";
import { rmdir, mkdir, createWriteStream, exists } from "../src/fs";
import { rmrf } from "../src/fs";
import * as uuidv4 from "uuid/v4";

describe("fs module tests", () => {
    test(`rmrf deletes directory recursively`, async () => {
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
        expect(await exists(file)).toBe(true);
        expect(await exists(subdir)).toBe(true);
        expect(await exists(tmp)).toBe(true);
        await rmrf(tmp);
        expect(await exists(file)).toBe(false);
        expect(await exists(subdir)).toBe(false);
        expect(await exists(tmp)).toBe(false);
    });

    test("mkdir succeeds on directories that already exist", async () => {
        const dir = path.join(tmpdir(), "cloudify-test");
        expect(await mkdir(dir)).toBeUndefined();
        expect(await mkdir(dir)).toBeUndefined();
        expect(await exists(dir)).toBe(true);
        await rmrf(dir);
    });

    test("mkdir recursive", async () => {
        const testDir = path.join(tmpdir(), "cloudify-test");
        const dir = path.join(testDir, uuidv4(), uuidv4());
        expect(await mkdir(dir, { recursive: true })).toBeUndefined();
        expect(await exists(dir)).toBe(true);
        await rmrf(testDir);
    });
});

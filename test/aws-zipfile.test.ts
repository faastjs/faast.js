import { testCodeBundle } from "./tests";
import { existsSync } from "fs";
import { join } from "path";

const kb = 1024;

describe("aws zip file package", () => {
    describe("queue bundle", () =>
        testCodeBundle("aws", "queue-bundle", 100 * kb, {
            mode: "queue"
        }));

    describe("https bundle", () =>
        testCodeBundle("aws", "https-bundle", 100 * kb, {
            mode: "https"
        }));

    describe("queue bundle with child process", () =>
        testCodeBundle("aws", "queue-bundle-childprocess", 100 * kb, {
            mode: "queue",
            childProcess: true
        }));

    describe("https bundle with child process", () =>
        testCodeBundle("aws", "https-bundle-childprocess", 100 * kb, {
            mode: "https",
            childProcess: true
        }));

    describe("bundle with added directory", () =>
        testCodeBundle(
            "aws",
            "added-directory",
            100 * kb,
            {
                addDirectory: "test/addedDirectory"
            },
            root => expect(existsSync(join(root, "file.txt"))).toBe(true)
        ));

    describe("bundle with added zip file", () =>
        testCodeBundle(
            "aws",
            "added-zipfile",
            100 * kb,
            {
                addZipFile: "test/addedDirectory/file.txt.zip"
            },
            root => expect(existsSync(join(root, "file.txt"))).toBe(true)
        ));
});

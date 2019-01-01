import { testCodeBundle } from "./tests";
import * as awsFaast from "../src/aws/aws-faast";
import { existsSync } from "fs";
import { join } from "path";

const kb = 1024;

describe("aws zip file package", () => {
    describe("queue bundle", () =>
        testCodeBundle(awsFaast.Impl, "queue-bundle", 100 * kb, {
            mode: "queue"
        }));

    describe("https bundle", () =>
        testCodeBundle(awsFaast.Impl, "https-bundle", 100 * kb, {
            mode: "https"
        }));

    describe("queue bundle with child process", () =>
        testCodeBundle(awsFaast.Impl, "queue-bundle-childprocess", 100 * kb, {
            mode: "queue",
            childProcess: true
        }));

    describe("https bundle with child process", () =>
        testCodeBundle(awsFaast.Impl, "https-bundle-childprocess", 100 * kb, {
            mode: "https",
            childProcess: true
        }));

    describe("bundle with added directory", () =>
        testCodeBundle(
            awsFaast.Impl,
            "added-directory",
            100 * kb,
            {
                addDirectory: "test/addedDirectory"
            },
            root => expect(existsSync(join(root, "file.txt"))).toBe(true)
        ));

    describe("bundle with added zip file", () =>
        testCodeBundle(
            awsFaast.Impl,
            "added-zipfile",
            100 * kb,
            {
                addZipFile: "test/addedDirectory/file.txt.zip"
            },
            root => expect(existsSync(join(root, "file.txt"))).toBe(true)
        ));
});

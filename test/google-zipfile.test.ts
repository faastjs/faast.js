import { testCodeBundle } from "./tests";
import * as path from "path";

const kb = 1024;

describe("google zip file package", () => {
    describe("https function with bundling", () =>
        testCodeBundle("google", "https-bundle", 100 * kb));

    describe("https function with package.json", () =>
        testCodeBundle("google", "https-package", 100 * kb, {
            packageJson: "test/package.json"
        }));

    describe("https function with bundling and childprocess", () =>
        testCodeBundle("google", "https-bundle-childprocess", 100 * kb, {
            childProcess: true
        }));

    describe("queue function with bundling", () =>
        testCodeBundle("google", "queue-bundle", 700 * kb, {
            mode: "queue"
        }));

    describe("queue function with package.json", () =>
        testCodeBundle("google", "queue-package", 100 * kb, {
            mode: "queue",
            packageJson: "test/package.json"
        }));

    describe("queue function with bundling and childprocess", () =>
        testCodeBundle("google", "queue-bundle-childprocess", 700 * kb, {
            mode: "queue",
            childProcess: true
        }));

    describe.skip("emulator https function", () =>
        testCodeBundle("google-emulator", "emulator-https-bundle", 100 * kb));
});

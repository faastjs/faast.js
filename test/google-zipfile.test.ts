import { checkCodeBundle } from "./tests";
import * as path from "path";

const kb = 1024;

describe("google zip file package", () => {
    describe("https function with bundling", () =>
        checkCodeBundle("google", "https-bundle", 100 * kb));

    describe("https function with package.json", () =>
        checkCodeBundle("google", "https-package", 100 * kb, {
            packageJson: "test/package.json"
        }));

    describe("https function with bundling and childprocess", () =>
        checkCodeBundle("google", "https-bundle-childprocess", 100 * kb, {
            childProcess: true
        }));

    describe("queue function with bundling", () =>
        checkCodeBundle("google", "queue-bundle", 700 * kb, {
            mode: "queue"
        }));

    describe("queue function with package.json", () =>
        checkCodeBundle("google", "queue-package", 100 * kb, {
            mode: "queue",
            packageJson: "test/package.json"
        }));

    describe("queue function with bundling and childprocess", () =>
        checkCodeBundle("google", "queue-bundle-childprocess", 700 * kb, {
            mode: "queue",
            childProcess: true
        }));

    describe.skip("emulator https function", () =>
        checkCodeBundle("google-emulator", "emulator-https-bundle", 100 * kb));
});

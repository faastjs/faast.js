import * as googleFaast from "../src/google/google-faast";
import { testCodeBundle } from "./tests";

const kb = 1024;

describe("google zip file package", () => {
    describe("https function with bundling", () =>
        testCodeBundle(googleFaast.Impl, "https-bundle", 100 * kb));

    describe("https function with package.json", () =>
        testCodeBundle(googleFaast.Impl, "https-package", 100 * kb, {
            packageJson: "test/package.json"
        }));

    describe("https function with bundling and childprocess", () =>
        testCodeBundle(googleFaast.Impl, "https-bundle-childprocess", 100 * kb, {
            childProcess: true
        }));

    describe("queue function with bundling", () =>
        testCodeBundle(googleFaast.Impl, "queue-bundle", 700 * kb, {
            mode: "queue"
        }));

    describe("queue function with package.json", () =>
        testCodeBundle(googleFaast.Impl, "queue-package", 100 * kb, {
            mode: "queue",
            packageJson: "test/package.json"
        }));

    describe("queue function with bundling and childprocess", () =>
        testCodeBundle(googleFaast.Impl, "queue-bundle-childprocess", 700 * kb, {
            mode: "queue",
            childProcess: true
        }));

    // describe("emulator https function", () =>
    //     testCodeBundle("google-emulator", "emulator-https-bundle", 100 * kb));
});

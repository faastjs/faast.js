import { checkCodeBundle } from "./tests";
import * as path from "path";

const kb = 1024;

checkCodeBundle(
    "Package google https function with bundling",
    "google",
    "https-bundle",
    100 * kb
);

checkCodeBundle(
    "Package google https function with package.json",
    "google",
    "https-package",
    100 * kb,
    { packageJson: "test/package.json" }
);

checkCodeBundle(
    "Package google queue function with bundling",
    "google",
    "queue-bundle",
    700 * kb,
    {
        mode: "queue"
    }
);

checkCodeBundle(
    "Package google queue function with package.json",
    "google",
    "queue-package",
    100 * kb,
    {
        mode: "queue",
        packageJson: "test/package.json"
    }
);

checkCodeBundle(
    "Package google emulator https function",
    "google-emulator",
    "emulator-https-bundle",
    100 * kb
);

import { checkCodeBundle } from "./tests";
import * as path from "path";

checkCodeBundle("Package google https function with bundling", "google", "https-bundle");

checkCodeBundle(
    "Package google https function with package.json",
    "google",
    "https-package",
    {},
    "test/package-server.json"
);

checkCodeBundle("Package google queue function with bundling", "google", "queue-bundle", {
    useQueue: true
});

checkCodeBundle(
    "Package google queue function with package.json",
    "google",
    "queue-package",
    {
        useQueue: true
    },
    "test/package-server.json"
);

checkCodeBundle(
    "Package google emulator https function",
    "google-emulator",
    "emulator-https-bundle"
);

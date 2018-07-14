import { checkCodeBundle } from "./tests";
import * as path from "path";

checkCodeBundle("Google code bundle", "google");

checkCodeBundle(
    "Google code bundle with package.json",
    "google",
    "package",
    "test/package-server.json"
);

checkCodeBundle("Google emulator code bundle", "google-emulator");

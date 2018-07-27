import { checkCodeBundle } from "./tests";
import { existsSync } from "fs";
import { join } from "path";

const kb = 1024;

checkCodeBundle("Package AWS queue bundle", "aws", "https-bundle", 50 * kb, {
    useQueue: false
});

checkCodeBundle("Package AWS https bundle", "aws", "queue-bundle", 50 * kb, {
    useQueue: true
});

checkCodeBundle(
    "Package AWS bundle with added directory",
    "aws",
    "added-directory",
    100 * kb,
    {
        addDirectory: "test/addedDirectory"
    },
    root => expect(existsSync(join(root, "file.txt"))).toBe(true)
);

checkCodeBundle(
    "Package AWS bundle with added zip file",
    "aws",
    "added-zipfile",
    100 * kb,
    {
        addZipFile: "test/addedDirectory/file.txt.zip"
    },
    root => expect(existsSync(join(root, "file.txt"))).toBe(true)
);

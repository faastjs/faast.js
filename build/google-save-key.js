const { writeFile } = require("fs-extra");
const { join } = require("path");
const { cwd } = require("process");

// This code is only used for running builds on CircleCI. It saves Google Cloud
// credentials to disk to enable testing the Google Cloud APIs.

async function saveKey() {
    try {
        const key = process.env["GOOGLE_KEY_VALUE"];
        const keyFile = join(cwd(), "gcp-key.json");
        await writeFile(keyFile, key, { mode: 0o600 });
    } catch (err) {
        console.warn(`Could not find Google service account key: ${err}`);
    }
}

saveKey();

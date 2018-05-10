import * as crypto from "crypto";
import * as fs from "fs";

export function sha256ofFile(filename: string) {
    return new Promise<string>((resolve, reject) => {
        const sha256 = crypto.createHash("sha256");
        const input = fs.createReadStream(filename);
        input.on("readable", () => {
            const data = input.read();
            if (data) {
                sha256.update(data);
            } else {
                resolve(sha256.digest("hex"));
            }
        });
        input.on("error", reject);
    });
}

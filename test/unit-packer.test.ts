import { join } from "path";
import { CommonOptions, CloudFunctionImpl } from "../src/provider";
import { _providers } from "../src/faast";
import * as sys from "child_process";
import { PassThrough } from "stream";
import { rmrf, stat, createWriteStream, exists } from "../src/fs";
import { unzipInDir } from "../src/packer";
import * as path from "path";
import { info } from "../src/log";

const kb = 1024;

interface PackageConfiguration extends CommonOptions {
    name: string;
    check?: (root: string) => Promise<void>;
}

async function hasAddedFile(root: string) {
    expect(await exists(join(root, "file.txt"))).toBe(true);
}

const coreConfigs: PackageConfiguration[] = [
    { name: "https", mode: "https", childProcess: false },
    { name: "https-childprocess", mode: "https", childProcess: true },
    { name: "queue", mode: "queue", childProcess: false },
    { name: "queue-childprocess", mode: "queue", childProcess: true }
];

const configs: PackageConfiguration[] = [
    ...coreConfigs,
    ...coreConfigs.map(c => ({ ...c, packageJson: "test/package.json" })),
    { name: "addDirectory", addDirectory: "test/dir", check: hasAddedFile },
    { name: "addZipFile", addZipFile: "test/dir/file.txt.zip", check: hasAddedFile }
];

function exec(cmd: string) {
    const result = sys.execSync(cmd).toString();
    info(result);
    return result;
}

export function testCodeBundle<O, S>(
    impl: CloudFunctionImpl<O, S>,
    packageType: string,
    maxZipFileSize?: number,
    options?: O,
    expectations?: (root: string) => Promise<void>
) {
    test(
        "package zip file",
        async () => {
            const identifier = `func-${impl.name}-${packageType}`;
            const tmpDir = path.join("tmp", identifier);
            exec(`mkdir -p ${tmpDir}`);

            const { archive } = await impl.pack(require.resolve("./functions"), options);

            const stream1 = archive.pipe(new PassThrough());
            const stream2 = archive.pipe(new PassThrough());

            const zipFile = path.join("tmp", identifier + ".zip");
            stream2.pipe(createWriteStream(zipFile));
            const writePromise = new Promise(resolve => stream2.on("end", resolve));

            await rmrf(tmpDir);
            const unzipPromise = unzipInDir(tmpDir, stream1);

            await Promise.all([writePromise, unzipPromise]);
            const bytes = (await stat(zipFile)).size;
            maxZipFileSize && expect(bytes).toBeLessThan(maxZipFileSize);
            expect(exec(`cd ${tmpDir} && node index.js`)).toMatch(
                "faast: successful cold start."
            );
            expectations && (await expectations(tmpDir));
        },
        30 * 1000
    );
}

describe.each(_providers)("%s package", (name, impl) => {
    describe.each(configs)("with options %p", (options: PackageConfiguration) => {
        let size = 100 * kb;
        if (name === "google" && !options.packageJson) {
            size = 700 * kb;
        }
        testCodeBundle(impl, options.name, size, options, options.check);
    });
});

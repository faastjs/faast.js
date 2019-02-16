import test, { ExecutionContext, Macro } from "ava";
import * as sys from "child_process";
import * as path from "path";
import { join } from "path";
import { PassThrough } from "stream";
import { _providers } from "../src/faast";
import { createWriteStream, exists, rmrf, stat } from "../src/fs";
import { info } from "../src/log";
import { unzipInDir } from "../src/packer";
import { CloudFunctionImpl, CommonOptions } from "../src/provider";
import { keys } from "../src/shared";

const kb = 1024;

interface PackageConfiguration extends CommonOptions {
    name: string;
    check?: (t: ExecutionContext, root: string) => Promise<void>;
}

function exec(cmd: string) {
    const result = sys.execSync(cmd).toString();
    info(result);
    return result;
}

const macro: Macro<[CloudFunctionImpl<any, any>, PackageConfiguration, number]> = async (
    t: ExecutionContext,
    impl: CloudFunctionImpl<any, any>,
    config: PackageConfiguration,
    size: number
) => {
    const identifier = `func-${impl.name}-${config.name}`;
    const tmpDir = path.join("tmp", identifier);
    exec(`mkdir -p ${tmpDir}`);

    const { archive } = await impl.pack(require.resolve("./functions"), config);

    const stream1 = archive.pipe(new PassThrough());
    const stream2 = archive.pipe(new PassThrough());

    const zipFile = path.join("tmp", identifier + ".zip");
    stream2.pipe(createWriteStream(zipFile));
    const writePromise = new Promise(resolve => stream2.on("end", resolve));

    await rmrf(tmpDir);
    const unzipPromise = unzipInDir(tmpDir, stream1);

    await Promise.all([writePromise, unzipPromise]);
    const bytes = (await stat(zipFile)).size;
    t.true(bytes < size);
    t.is(exec(`cd ${tmpDir} && node index.js`), "faast: successful cold start.\n");
    config.check && (await config.check(t, tmpDir));
};

macro.title = (_title = "", impl, options) => `${impl.name}-${options.name}`;

function pkg(config: PackageConfiguration) {
    const name = config.name + "-package";
    return { ...config, name, packageJson: "test/fixtures/package.json" };
}

async function hasAddedFile(t: ExecutionContext, root: string) {
    t.true(await exists(join(root, "file.txt")));
}

const configs: PackageConfiguration[] = [
    { name: "https", mode: "https", childProcess: false },
    { name: "https-childprocess", mode: "https", childProcess: true },
    { name: "queue", mode: "queue", childProcess: false },
    { name: "queue-childprocess", mode: "queue", childProcess: true },
    pkg({ name: "https", mode: "https", childProcess: false }),
    pkg({ name: "https-childprocess", mode: "https", childProcess: true }),
    pkg({ name: "queue", mode: "queue", childProcess: false }),
    pkg({ name: "queue-childprocess", mode: "queue", childProcess: true }),
    { name: "addDirectory", addDirectory: "test/fixtures", check: hasAddedFile },
    { name: "addZipFile", addZipFile: "test/fixtures/file.txt.zip", check: hasAddedFile }
];

const providers = keys(_providers);
// const providers: Provider[] = ["local"];

for (const name of providers) {
    for (const config of configs) {
        let size = 100 * kb;
        if (name === "google" && !config.packageJson) {
            size = 700 * kb;
        }
        test(macro, _providers[name], config, size);
    }
}

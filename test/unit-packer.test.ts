import test, { ExecutionContext, Macro } from "ava";
import * as sys from "child_process";
import { createWriteStream, pathExists, remove, stat } from "fs-extra";
import * as path from "path";
import { join } from "path";
import { PassThrough } from "stream";
import { CommonOptions, info, Provider, providers } from "../index";
import { awsPacker } from "../src/aws/aws-faast";
import { googlePacker } from "../src/google/google-faast";
import { localPacker } from "../src/local/local-faast";
import { PackerResult, unzipInDir } from "../src/packer";
import { WrapperOptions } from "../src/wrapper";

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

type Packer = (
    functionModule: string,
    options: CommonOptions,
    wrapperOptions: WrapperOptions
) => Promise<PackerResult>;

const testPacker: Macro<[Provider, Packer, PackageConfiguration, number]> = async (
    t: ExecutionContext,
    provider: Provider,
    pack: Packer,
    config: PackageConfiguration,
    size: number
) => {
    const identifier = `func-${provider}-${config.name}`;
    const tmpDir = path.join("tmp", identifier);
    exec(`mkdir -p ${tmpDir}`);

    const { archive } = await pack(require.resolve("./fixtures/functions"), config, {});

    const stream1 = archive.pipe(new PassThrough());
    const stream2 = archive.pipe(new PassThrough());

    const zipFile = path.join("tmp", identifier + ".zip");
    stream2.pipe(createWriteStream(zipFile));
    const writePromise = new Promise(resolve => stream2.on("end", resolve));

    await remove(tmpDir);
    const unzipPromise = unzipInDir(tmpDir, stream1);

    await Promise.all([writePromise, unzipPromise]);
    const bytes = (await stat(zipFile)).size;
    t.true(bytes < size);
    t.is(exec(`cd ${tmpDir} && node index.js`), "faast: successful cold start.\n");
    config.check && (await config.check(t, tmpDir));
};

testPacker.title = (_title = "", provider, _packer, options) =>
    `${provider}-${options.name}`;

function pkg(config: PackageConfiguration) {
    const name = config.name + "-package";
    return { ...config, name, packageJson: "test/fixtures/package.json" };
}

async function hasAddedFile(t: ExecutionContext, root: string) {
    t.true(await pathExists(join(root, "file.txt")));
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

const packers: { [provider in Provider]: Packer } = {
    aws: awsPacker,
    google: googlePacker,
    local: localPacker
};

for (const name of providers) {
    for (const config of configs) {
        let size = 130 * kb;
        if (name === "google" && !config.packageJson) {
            size = 700 * kb;
        }
        test(testPacker, name, packers[name], config, size);
    }
}

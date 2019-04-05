import test, { ExecutionContext, Macro } from "ava";
import * as sys from "child_process";
import { createWriteStream, pathExists, remove, stat } from "fs-extra";
import * as path from "path";
import { join } from "path";
import { PassThrough } from "stream";
import { CommonOptions, log, Provider, providers } from "../index";
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
    log.info(result);
    return result;
}

type Packer = (
    functionModule: string,
    parentDir: string,
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

    const { archive } = await pack(
        require.resolve("./fixtures/functions"),
        __dirname,
        config,
        {}
    );

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
    `packer ${provider}-${options.name}`;

async function addedFile(t: ExecutionContext, root: string) {
    t.true(await pathExists(join(root, "file.txt")));
}

const configs: PackageConfiguration[] = [
    { name: "https", mode: "https" },
    { name: "queue", mode: "queue" },
    { name: "https-package", mode: "https", packageJson: "test/fixtures/package.json" },
    { name: "queue-package", mode: "queue", packageJson: "test/fixtures/package.json" },
    { name: "addDirectory", addDirectory: "test/fixtures/dir", check: addedFile },
    { name: "addZipFile", addZipFile: "test/fixtures/file.txt.zip", check: addedFile },
    {
        name: "addDirectory-rel",
        addDirectory: "../../test/fixtures/dir",
        check: addedFile
    },
    {
        name: "addZipFile-rel",
        addZipFile: "../../test/fixtures/file.txt.zip",
        check: addedFile
    }
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
            size = 750 * kb;
        }
        test(testPacker, name, packers[name], config, size);
    }
}

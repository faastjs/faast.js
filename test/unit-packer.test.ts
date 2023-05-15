import test, { ExecutionContext } from "ava";
import sys from "child_process";
import { pathExists, remove, stat } from "fs-extra";
import path from "path";
import { join } from "path";
import { CommonOptions, log, Provider, providers } from "../index";
import { awsPacker } from "../src/aws/aws-faast";
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
    options: CommonOptions,
    wrapperOptions: WrapperOptions,
    FunctionName: string
) => Promise<PackerResult>;

const testPacker = test.macro({
    exec: async (
        t: ExecutionContext,
        provider: Provider,
        pack: Packer,
        config: PackageConfiguration,
        size: number
    ) => {
        const identifier = `${provider}-${config.name}`;
        const tmpDir = path.join("tmp", identifier);
        exec(`mkdir -p ${tmpDir}`);

        process.env["FAAST_PACKAGE_DIR"] = "tmp";

        const { archive } = await pack(
            require.resolve("./fixtures/functions"),
            config,
            {},
            identifier
        );

        await remove(tmpDir);
        const writePromise = new Promise(resolve => archive.on("end", resolve));
        const unzipPromise = unzipInDir(tmpDir, archive);

        await Promise.all([writePromise, unzipPromise]);
        const zipFile = path.join("tmp", identifier + ".zip");
        const bytes = (await stat(zipFile)).size;
        t.true(bytes < size, `package size ${bytes} exceeded maximum ${size}`);
        t.is(exec(`cd ${tmpDir} && node index.js`), "faast: successful cold start.\n");
        config.check && (await config.check(t, tmpDir));
    },
    title: (_title = "", provider, _packer, options) =>
        `packer ${provider}-${options.name}`
});

function added(dir: string) {
    return async (t: ExecutionContext, root: string) => {
        const filePath = join(root, dir, "file.txt");
        t.true(await pathExists(filePath), `file ${filePath} does not exist in package`);
        const { mode } = await stat(join(root, dir, "script"));
        const { mode: origMode } = await stat("test/fixtures/dir/script");
        t.is(mode, origMode, "file modes are preserved");
        t.is(mode & 0o700, 0o700, "executable mode is preserved in added files");
    };
}

function excluded(file: string) {
    return async (t: ExecutionContext, root: string) => {
        const filePath = join(root, file);
        t.false(
            await pathExists(filePath),
            `file ${file} exists but it should be excluded`
        );
    };
}

const configs: PackageConfiguration[] = [
    { name: "https", mode: "https" },
    { name: "queue", mode: "queue" },
    { name: "https-package", mode: "https", packageJson: "test/fixtures/package.json" },
    { name: "queue-package", mode: "queue", packageJson: "test/fixtures/package.json" },
    {
        name: "include",
        include: ["test/fixtures/dir/**/*"],
        check: added("test/fixtures/dir")
    },
    {
        name: "include-cwd",
        include: [{ path: "dir/**/*", cwd: "test/fixtures" }],
        check: added("dir")
    },
    {
        name: "include-dir",
        include: ["test/fixtures/dir"],
        check: added("test/fixtures/dir")
    },
    {
        name: "include-dir-cwd",
        include: [{ path: "dir", cwd: "test/fixtures" }],
        check: added("dir")
    },
    {
        name: "exclude",
        include: ["test/fixtures/dir/**/*"],
        exclude: ["**/*.exc"],
        check: excluded("test/fixtures/dir/excluded.exc")
    },
    {
        name: "exclude-file",
        include: ["test/fixtures/dir/**/*"],
        exclude: ["test/fixtures/dir/excluded.exc"],
        check: excluded("test/fixtures/dir/excluded.exc")
    }
];

const packers: { [provider in Provider]: Packer } = {
    aws: awsPacker,
    local: localPacker
};

for (const name of providers) {
    for (const config of configs) {
        let size = 130 * kb;
        test(testPacker, name, packers[name], config, size);
    }
}

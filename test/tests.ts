import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";
import * as sys from "child_process";
import * as fs from "fs";
import * as aws from "../src/aws/aws-cloudify";
import * as google from "../src/google/google-cloudify";
import * as path from "path";

export function checkFunctions(
    description: string,
    cloudProvider: cloudify.CloudProvider,
    options?: cloudify.CreateFunctionOptions<any>
) {
    describe(description, () => {
        let remote: cloudify.Promisified<typeof funcs>;
        let lambda: cloudify.CloudFunction<any>;

        beforeAll(async () => {
            try {
                const cloud = cloudify.create(cloudProvider);
                lambda = await cloud.createFunction("./functions", {
                    ...options,
                    timeout: 30,
                    memorySize: 512
                });
                remote = lambda.cloudifyAll(funcs);
            } catch (err) {
                console.error(err);
            }
        }, 90 * 1000);

        afterAll(async () => {
            await lambda.cleanup();
            // await lambda.stop();
        }, 60 * 1000);

        test("hello: string => string", async () => {
            expect(await remote.hello("Andy")).toBe("Hello Andy!");
        });

        test("fact: number => number", async () => {
            expect(await remote.fact(5)).toBe(120);
        });

        test("concat: (string, string) => string", async () => {
            expect(await remote.concat("abc", "def")).toBe("abcdef");
        });

        test("error: string => raise exception", async () => {
            expect(await remote.error("hey").catch(err => err.message)).toBe(
                "Expected this error. Argument: hey"
            );
        });

        test("noargs: () => string", async () => {
            expect(await remote.noargs()).toBe(
                "successfully called function with no args."
            );
        });

        test("async: () => Promise<string>", async () => {
            expect(await remote.async()).toBe(
                "returned successfully from async function"
            );
        });

        test("path: () => Promise<string>", async () => {
            expect(typeof (await remote.path())).toBe("string");
        });

        test("rejected: () => rejected promise", async () => {
            expect.assertions(1);
            await expect(remote.rejected()).rejects.toThrowError();
        });
    });
}

function exec(cmd: string) {
    const result = sys.execSync(cmd).toString();
    console.log(result);
    return result;
}

function unzipInDir(dir: string, zipFile: string) {
    exec(`rm -rf ${dir} && mkdir -p ${dir} && unzip ${zipFile} -d ${dir}`);
}

export function checkCodeBundle(
    description: string,
    cloudProvider: "aws",
    packageType: string,
    maxZipFileSize?: number,
    options?: aws.Options,
    packageJson?: string
): void;
export function checkCodeBundle(
    description: string,
    cloudProvider: "google" | "google-emulator",
    packageType: string,
    maxZipFileSize?: number,
    options?: google.Options,
    packageJson?: string
): void;
export function checkCodeBundle(
    description: string,
    cloudProvider: cloudify.CloudProvider,
    packageType: string,
    maxZipFileSize?: number,
    options?: any,
    packageJson?: string
) {
    describe(description, () => {
        test(
            "package zip file",
            async () => {
                const identifier = `func-${cloudProvider}-${packageType}`;
                const tmpDir = path.join("tmp", identifier);
                exec(`mkdir -p ${tmpDir}`);
                const zipFile = path.join("tmp", identifier) + ".zip";
                const { archive } = await cloudify
                    .create(cloudProvider)
                    .pack("./functions", options, { packageJson });

                await new Promise((resolve, reject) => {
                    const output = fs.createWriteStream(zipFile);
                    output.on("finish", resolve);
                    output.on("error", reject);
                    archive.pipe(output);
                });
                maxZipFileSize &&
                    expect(fs.statSync(zipFile).size).toBeLessThan(maxZipFileSize);
                unzipInDir(tmpDir, zipFile);
                expect(exec(`cd ${tmpDir} && node index.js`)).toMatch(
                    "Successfully loaded cloudify trampoline function."
                );
            },
            30 * 1000
        );
    });
}

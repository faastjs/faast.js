import * as sys from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as awsCloudify from "../src/aws/aws-cloudify";
import * as cloudify from "../src/cloudify";
import * as googleCloudify from "../src/google/google-cloudify";
import { disableWarnings, enableWarnings, log, warn } from "../src/log";
import { sleep } from "../src/shared";
import * as funcs from "./functions";

export function checkFunctions(
    description: string,
    cloudProvider: "aws",
    options: awsCloudify.Options
): void;
export function checkFunctions(
    description: string,
    cloudProvider: cloudify.CloudProvider,
    options: cloudify.CommonOptions
): void;
export function checkFunctions(
    description: string,
    cloudProvider: cloudify.CloudProvider,
    options: cloudify.CommonOptions
): void {
    describe(description, () => {
        let remote: cloudify.Promisified<typeof funcs>;
        let lambda: cloudify.AnyCloudFunction;

        beforeAll(async () => {
            try {
                const cloud = cloudify.create(cloudProvider);
                options.timeout = 30;
                options.memorySize = 512;
                lambda = await cloud.createFunction("./functions", options);
                remote = lambda.cloudifyAll(funcs);
            } catch (err) {
                warn(err);
            }
        }, 180 * 1000);

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

        test("promise args not supported", async () => {
            const saved = disableWarnings();
            expect(await remote.promiseArg(Promise.resolve("hello"))).toEqual({});
            saved && enableWarnings();
        });

        test("optional arguments are supported", async () => {
            expect(await remote.optionalArg()).toBe("No arg");
            expect(await remote.optionalArg("has arg")).toBe("has arg");
        });
    });
}

function exec(cmd: string) {
    const result = sys.execSync(cmd).toString();
    log(result);
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
    options?: awsCloudify.Options,
    expectations?: (root: string) => void
): void;
export function checkCodeBundle(
    description: string,
    cloudProvider: "google" | "google-emulator",
    packageType: string,
    maxZipFileSize?: number,
    options?: googleCloudify.Options,
    expectations?: (root: string) => void
): void;
export function checkCodeBundle(
    description: string,
    cloudProvider: cloudify.CloudProvider,
    packageType: string,
    maxZipFileSize?: number,
    options?: any,
    expectations?: (root: string) => void
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
                    .pack("./functions", options);

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
                expectations && expectations(tmpDir);
            },
            30 * 1000
        );
    });
}

export function checkLogs(description: string, cloudProvider: cloudify.CloudProvider) {
    describe(description, () => {
        let remote: cloudify.Promisified<typeof funcs>;
        let lambda: cloudify.AnyCloudFunction;

        beforeAll(async () => {
            try {
                const cloud = cloudify.create(cloudProvider);
                const options = {
                    timeout: 30,
                    memorySize: 512
                };
                lambda = await cloud.createFunction("./functions", options);
                remote = lambda.cloudifyAll(funcs);
            } catch (err) {
                warn(err);
            }
        }, 90 * 1000);

        afterAll(async () => {
            await lambda.cleanup();
            // await lambda.stop();
        }, 60 * 1000);

        test(
            "logs",
            async () => {
                const received = {};
                let logger;
                const logPromise = new Promise(resolve => {
                    logger = (msg: string) => {
                        // log(`logger: ${msg}`);
                        const result = msg.match(/(console.\w+) works/);
                        if (result && result[1]) {
                            received[result[1]] = true;
                        }
                        // log(`received: %O`, received);
                        if (Object.keys(received).length === 4) {
                            resolve();
                        }
                    };
                });
                lambda.setLogger(logger);
                await remote.consoleLog("console.log works");
                await remote.consoleWarn("console.warn works");
                await remote.consoleError("console.error works");
                await remote.consoleInfo("console.info works");
                await logPromise;
                lambda.setLogger(undefined);
                expect(received["console.log"]).toBe(true);
                expect(received["console.warn"]).toBe(true);
                expect(received["console.error"]).toBe(true);
                expect(received["console.info"]).toBe(true);
            },
            120 * 1000
        );
    });
}

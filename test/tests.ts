import * as sys from "child_process";
import * as fs from "fs";
import * as path from "path";
import { PassThrough } from "stream";
import * as awsCloudify from "../src/aws/aws-cloudify";
import * as cloudify from "../src/cloudify";
import * as googleCloudify from "../src/google/google-cloudify";
import { info, warn } from "../src/log";
import { unzipInDir } from "../src/packer";
import * as funcs from "./functions";

export function checkFunctions(cloudProvider: "aws", options: awsCloudify.Options): void;
export function checkFunctions(
    cloudProvider: "immediate",
    options: cloudify.immediate.Options
): void;
export function checkFunctions(
    cloudProvider: cloudify.CloudProvider,
    options: cloudify.CommonOptions
): void;
export function checkFunctions(
    cloudProvider: cloudify.CloudProvider,
    options: cloudify.CommonOptions
): void {
    let remote: cloudify.Promisified<typeof funcs>;
    let cloudFunc: cloudify.AnyCloudFunction;

    beforeAll(async () => {
        try {
            const start = Date.now();
            const opts = { timeout: 30, memorySize: 512, ...options };
            ({ remote, cloudFunc } = await cloudify.cloudify(
                cloudProvider,
                funcs,
                "./functions",
                opts
            ));
            info(`Function creation took ${((Date.now() - start) / 1000).toFixed(1)}s`);
        } catch (err) {
            warn(err);
        }
    }, 180 * 1000);

    afterAll(async () => {
        await cloudFunc.cleanup();
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
        expect.assertions(1);
        try {
            const rv = await remote.error("hey");
        } catch (err) {
            expect(err.message).toMatch("Expected this error. Argument: hey");
        }
    });

    test("noargs: () => string", async () => {
        expect(await remote.noargs()).toBe("successfully called function with no args.");
    });

    test("async: () => Promise<string>", async () => {
        expect(await remote.async()).toBe("returned successfully from async function");
    });

    test("path: () => Promise<string>", async () => {
        expect(typeof (await remote.path())).toBe("string");
    });

    test("rejected: () => rejected promise", async () => {
        expect.assertions(1);
        try {
            await remote.rejected();
        } catch (err) {
            expect(err).toBe("This promise is intentionally rejected.");
        }
    });

    test("empty promise rejection", async () => {
        expect.assertions(1);
        try {
            await remote.emptyReject();
        } catch (err) {
            expect(err).toBeUndefined();
        }
    });

    test("promise args not supported", async () => {
        expect.assertions(1);
        try {
            await remote.promiseArg(Promise.resolve("hello"));
        } catch (err) {
            expect(err).toBeInstanceOf(Error);
        }
    });

    test("optional arguments are supported", async () => {
        expect(await remote.optionalArg()).toBe("No arg");
        expect(await remote.optionalArg("has arg")).toBe("has arg");
    });
}

function exec(cmd: string) {
    const result = sys.execSync(cmd).toString();
    info(result);
    return result;
}

export function checkCodeBundle(
    cloudProvider: "aws",
    packageType: string,
    maxZipFileSize?: number,
    options?: awsCloudify.Options,
    expectations?: (root: string) => void
): void;
export function checkCodeBundle(
    cloudProvider: "google" | "google-emulator",
    packageType: string,
    maxZipFileSize?: number,
    options?: googleCloudify.Options,
    expectations?: (root: string) => void
): void;
export function checkCodeBundle(
    cloudProvider: cloudify.CloudProvider,
    packageType: string,
    maxZipFileSize?: number,
    options?: any,
    expectations?: (root: string) => void
) {
    test(
        "package zip file",
        async () => {
            const identifier = `func-${cloudProvider}-${packageType}`;
            const tmpDir = path.join("tmp", identifier);
            exec(`mkdir -p ${tmpDir}`);
            const { archive } = await cloudify
                .create(cloudProvider)
                .pack("./functions", options);

            const stream1 = archive.pipe(new PassThrough());
            const stream2 = archive.pipe(new PassThrough());

            const zipFile = path.join("tmp", identifier + ".zip");
            stream2.pipe(fs.createWriteStream(zipFile));
            const writePromise = new Promise(resolve => stream2.on("end", resolve));

            const unzipPromise = unzipInDir(tmpDir, stream1);

            await Promise.all([writePromise, unzipPromise]);
            const bytes = fs.statSync(zipFile).size;
            maxZipFileSize && expect(bytes).toBeLessThan(maxZipFileSize);
            expect(exec(`cd ${tmpDir} && node index.js`)).toMatch(
                "cloudify: successful cold start."
            );
            expectations && expectations(tmpDir);
        },
        30 * 1000
    );
}

export function checkCosts(
    cloudProvider: cloudify.CloudProvider,
    options: cloudify.CommonOptions = {}
) {
    let remote: cloudify.Promisified<typeof funcs>;
    let cloudFunc: cloudify.AnyCloudFunction;

    beforeAll(async () => {
        const args: cloudify.CommonOptions = {
            timeout: 30,
            memorySize: 512,
            mode: "queue"
        };
        ({ remote, cloudFunc } = await cloudify.cloudify(
            cloudProvider,
            funcs,
            "./functions",
            { ...args, ...options }
        ));
    }, 120 * 1000);

    afterAll(async () => {
        await cloudFunc.cleanup();
        // await lambda.stop();
    }, 60 * 1000);

    test(
        "cost for basic call",
        async () => {
            await remote.hello("there");
            const costs = await cloudFunc.costEstimate();
            info(`${costs}`);
            info(`CSV costs:\n${costs.csv()}`);

            const { estimatedBilledTime } = cloudFunc.functionStats.aggregate;
            expect((estimatedBilledTime.mean * estimatedBilledTime.samples) / 1000).toBe(
                costs.metrics.find(m => m.name === "functionCallDuration")!.measured
            );

            expect(costs.metrics.length).toBeGreaterThan(1);
            expect(costs.find("functionCallRequests")!.measured).toBe(1);
            for (const metric of costs.metrics) {
                if (!metric.alwaysZero) {
                    expect(metric.cost()).toBeGreaterThan(0);
                    expect(metric.measured).toBeGreaterThan(0);
                    expect(metric.pricing).toBeGreaterThan(0);
                }

                expect(metric.cost()).toBeLessThan(0.00001);
                expect(metric.name.length).toBeGreaterThan(0);
                expect(metric.unit.length).toBeGreaterThan(0);
                expect(metric.cost()).toBe(metric.pricing * metric.measured);
            }
            expect(costs.total()).toBeGreaterThan(0);
        },
        30 * 1000
    );
}

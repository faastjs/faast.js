import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";
import * as sys from "child_process";
import * as fs from "fs";

export function checkFunctions(
    description: string,
    cloudProvider: string,
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
    exec(
        `rm -rf ${dir} && mkdir -p ${dir} && cp ${zipFile} ${dir} && cd ${dir} && unzip -o ${zipFile}`
    );
}

export function checkCodeBundle(
    description: string,
    cloudProvider: string,
    zipFile: string
) {
    describe(description, () => {
        test("package zip file", async () => {
            const { archive } = await cloudify.create(cloudProvider).pack("./functions");

            await new Promise((resolve, reject) => {
                const output = fs.createWriteStream(zipFile);
                output.on("finish", resolve);
                output.on("error", reject);
                archive.pipe(output);
            });
            const dir = `tmp/${cloudProvider}`;
            unzipInDir(dir, zipFile);
            expect(exec(`cd ${dir} && node index.js`)).toMatch(
                "Successfully loaded cloudify trampoline function."
            );
        });
    });
}

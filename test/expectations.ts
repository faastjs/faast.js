import * as funcs from "./functions";
import { CloudFunctionService, Promisified } from "../src/cloudify";
import humanStringify from "human-stringify";

export function checkFunctions(
    description: string,
    service: () => Promisified<typeof funcs>
) {
    describe(description, () => {
        let remote: Promisified<typeof funcs>;

        beforeAll(() => {
            remote = service();
        });

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
            console.log(`AAA`);
            try {
                await remote
                    .rejected()
                    .catch(err => console.log(`Rejected: ${err.message}`));
            } catch (err) {
                console.log(`Caught ERR: ${err.message}`);
            }
            console.log(`BBB`);
            expect(await remote.rejected()).toThrow();
        });
    });
}

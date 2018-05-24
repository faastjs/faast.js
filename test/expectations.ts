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
            console.log(`Checking ${service.name}`);
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

        test("error: string => raise error", async () => {
            try {
                await remote.error("hey");
            } catch (err) {
                expect(err.message).toBe("Expected this error. Argument: hey");
            }
        });

        test("noargs: () => string", async () => {
            expect(await remote.noargs()).toBe(
                "successfully called function with no args."
            );
        });

        test("async: () => string", async () => {
            expect(await remote.async()).toBe(
                "returned successfully from async function"
            );
        });

        test("path: () => string", async () => {
            expect(typeof (await remote.path())).toBe("string");
        });
    });
}

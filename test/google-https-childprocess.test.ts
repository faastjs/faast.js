import { testFunctions } from "./tests";

jest.setTimeout(10 * 1000);
describe("google-https with child process", () =>
    testFunctions("google", { mode: "https", childProcess: true }));

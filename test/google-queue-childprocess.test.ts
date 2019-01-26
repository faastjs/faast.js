import { testFunctions } from "./tests";

jest.setTimeout(10 * 1000);
describe("google-queue with child process", () =>
    testFunctions("google", { mode: "queue", childProcess: true }, 360 * 1000));

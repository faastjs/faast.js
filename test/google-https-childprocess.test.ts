import { testFunctions } from "./tests";

describe("google-https with child process", () =>
    testFunctions("google", { mode: "https", childProcess: true }));

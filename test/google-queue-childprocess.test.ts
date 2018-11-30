import { testFunctions } from "./tests";

describe("google-queue with child process", () =>
    testFunctions("google", { mode: "queue", childProcess: true }));

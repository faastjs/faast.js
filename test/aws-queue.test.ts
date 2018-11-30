import { testFunctions } from "./tests";

describe("aws-queue", () => {
    describe("basic calls", () => testFunctions("aws", { mode: "queue" }));
    describe("basic calls with child process", () =>
        testFunctions("aws", { mode: "queue", childProcess: true }));
});

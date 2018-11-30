import { testFunctions } from "./tests";

describe("aws-https", () => {
    describe("basic calls", () => testFunctions("aws", { mode: "https" }));
    describe("basic calls with child process", () =>
        testFunctions("aws", { mode: "https", childProcess: true }));
});

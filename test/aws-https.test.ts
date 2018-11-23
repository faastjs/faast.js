import { checkFunctions } from "./tests";

describe("aws-https", () => {
    describe("basic calls", () => checkFunctions("aws", { mode: "https" }));
    describe("basic calls with child process", () =>
        checkFunctions("aws", { mode: "https", childProcess: true }));
});

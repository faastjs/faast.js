import { checkFunctions } from "./tests";

describe("aws-queue", () => {
    describe("basic calls", () => checkFunctions("aws", { mode: "queue" }));
    describe("basic calls with child process", () =>
        checkFunctions("aws", { mode: "queue", childProcess: true }));
});

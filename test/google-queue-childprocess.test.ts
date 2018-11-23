import { checkFunctions } from "./tests";

describe("google-queue with child process", () =>
    checkFunctions("google", {
        mode: "queue",
        childProcess: true
    }));

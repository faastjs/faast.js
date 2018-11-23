import { checkFunctions } from "./tests";

describe("google-https with child process", () =>
    checkFunctions("google", {
        mode: "https",
        childProcess: true
    }));

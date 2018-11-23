import { checkFunctions } from "./tests";

describe.skip("google-emulator", () => {
    describe("basic calls", () => checkFunctions("google-emulator", {}));
});

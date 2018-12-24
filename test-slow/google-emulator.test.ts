import { testFunctions } from "../test/tests";

describe.skip("google-emulator", () => {
    describe("basic calls", () => testFunctions("google-emulator", {}));
});

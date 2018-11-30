import { testRampUp } from "../test/tests";

describe("Google load ramp up", () => {
    describe("https mode", () =>
        testRampUp("google", 200, { mode: "https", memorySize: 1024 }));

    describe("queue mode", () =>
        testRampUp("google", 500, { mode: "queue", memorySize: 1024 }));
});

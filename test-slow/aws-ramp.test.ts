import { testRampUp } from "../test/tests";

describe("AWS load ramp up", () => {
    describe("https mode", () =>
        testRampUp("aws", 500, { memorySize: 1024, mode: "https" }));

    describe("queue mode", () =>
        testRampUp("aws", 500, { memorySize: 1024, mode: "queue" }));
});

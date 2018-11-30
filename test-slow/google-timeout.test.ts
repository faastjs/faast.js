import { testTimeout } from "../test/tests";

describe("Google timeout", () => {
    describe("https mode", () => testTimeout("google", { mode: "https" }));
    describe("queue mode", () => testTimeout("google", { mode: "queue" }));
});

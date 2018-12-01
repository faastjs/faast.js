import { testTimeout } from "../test/tests";

describe("Google timeout", () => {
    describe("https mode", () => testTimeout("google", { mode: "https" }));
    // Queue mode on google doesn't report timeout errors because there are no dead letter queues...
    // describe("queue mode", () => testTimeout("google", { mode: "queue" }));
});

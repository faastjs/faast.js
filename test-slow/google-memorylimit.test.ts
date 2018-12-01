import { testMemoryLimit } from "../test/tests";

describe("Google memory limit test", () => {
    describe("https mode", () => testMemoryLimit("google", { mode: "https" }));
    // Queue mode on google doesn't report out of memory errors because there are no dead letter queues...
    // describe("queue mode", () => testMemoryLimit("google", { mode: "queue" }));
});

import { testMemoryLimit } from "../test/tests";

describe("Google memory limit test", () => {
    describe("https mode", () => testMemoryLimit("google", { mode: "https" }));
    describe("queue mode", () => testMemoryLimit("google", { mode: "queue" }));
});

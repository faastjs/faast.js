import { testMemoryLimit } from "../test/tests";

describe("AWS memory limit test", () => {
    describe("https mode", () => testMemoryLimit("aws", { mode: "https" }));
    describe("queue mode", () => testMemoryLimit("aws", { mode: "queue" }));
});

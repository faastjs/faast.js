import { testThroughput } from "../test/tests";

describe("Google queue mode throughput test", () =>
    testThroughput("google", 180 * 1000, 500, { memorySize: 2048, mode: "queue" }));

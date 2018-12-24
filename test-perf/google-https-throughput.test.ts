import { testThroughput } from "../test/tests";

describe("Google https mode throughput", () =>
    testThroughput("google", 180 * 1000, 500, { memorySize: 2048, mode: "https" }));

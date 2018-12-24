import { testThroughput } from "../test/tests";

describe("local mode throughput", () =>
    testThroughput("local", 60 * 1000, 16, { memorySize: 64 }));

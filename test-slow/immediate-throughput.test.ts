import { testThroughput } from "../test/tests";

describe("Immediate mode throughput", () =>
    testThroughput("immediate", 60 * 1000, 16, { memorySize: 64 }));

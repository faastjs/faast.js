import { testThroughput } from "../test/tests";

describe("AWS https mode throughput", () =>
    testThroughput("aws", 180 * 1000, 500, { memorySize: 1728, mode: "https" }));

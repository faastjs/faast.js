import { throughputTest } from "./tests";

throughputTest("AWS https throughput test", "aws", 180 * 1000, 500, {
    memorySize: 1728,
    mode: "https"
});

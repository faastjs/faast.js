import { throughputTest } from "./tests";

throughputTest("AWS queue throughput test", "aws", 180 * 1000, 500, {
    memorySize: 1728,
    mode: "queue"
});

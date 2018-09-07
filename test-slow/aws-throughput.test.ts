import { throughputTest } from "./tests";

throughputTest("AWS throughput test", "aws", 60 * 1000, 500, {
    memorySize: 1024,
    useQueue: true
});

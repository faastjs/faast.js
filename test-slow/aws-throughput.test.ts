import { throughputTest } from "./tests";

throughputTest("AWS throughput test", "aws", 600 * 1000, {
    memorySize: 1024,
    useQueue: false
});

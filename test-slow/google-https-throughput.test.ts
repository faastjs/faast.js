import { throughputTest } from "./tests";

throughputTest("Google https throughput test", "google", 180 * 1000, 500, {
    memorySize: 2048,
    useQueue: false
});

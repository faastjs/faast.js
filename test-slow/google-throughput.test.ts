import { throughputTest } from "./tests";

throughputTest("Google throughput test", "google", 180 * 1000, 500, {
    memorySize: 2048,
    useQueue: true
});

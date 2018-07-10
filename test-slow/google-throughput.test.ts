import { throughputTest } from "./tests";

throughputTest("Google throughput test", "google", 600 * 1000, {
    memorySize: 1024,
    useQueue: false
});

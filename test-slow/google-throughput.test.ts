import { throughputTest } from "./tests";

throughputTest("Google throughput test", "google", 60 * 1000, 500, {
    memorySize: 1024,
    useQueue: false
});

import { throughputTest } from "./tests";

throughputTest("Immediate throughput test", "immediate", 60 * 1000, 16, {
    memorySize: 64
});

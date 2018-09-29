import { throughputTest } from "./tests";

throughputTest("Child process throughput test", "childprocess", 60 * 1000, 95, {
    memorySize: 64
});

import { throughputTest } from "./tests";

throughputTest("Child process throughput test", "childprocess", 60 * 1000, 96, {
    memorySize: 64
});

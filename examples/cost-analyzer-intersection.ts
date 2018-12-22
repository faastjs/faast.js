import { costAnalyzer, Promisified } from "../src/faast";
import * as m from "./module";

async function workload(remote: Promisified<typeof m>) {
    await remote.randomNumbers(20000000);
}

const configurations = [
    ...costAnalyzer.awsConfigurations.filter(c => {
        switch (c.options.memorySize) {
            case 128:
            case 256:
            case 512:
            case 1024:
            case 1728:
            case 2048:
                return true;
            default:
                return false;
        }
    }),
    ...costAnalyzer.googleConfigurations
];

async function compareIntersection() {
    costAnalyzer.estimateWorkloadCost(
        require.resolve("./module"),
        workload,
        configurations
    );
}

compareIntersection();

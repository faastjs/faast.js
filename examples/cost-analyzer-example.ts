import { costAnalyzer, Promisified } from "../src/cloudify";
import * as m from "./module";

async function workload(remote: Promisified<typeof m>) {
    await remote.hello("Jorge");
    await remote.randomNumbers(20000000);
}

async function compareIntersection() {
    costAnalyzer.estimateWorkloadCost(require.resolve("./module"), workload, [
        ...costAnalyzer.awsConfigurations.filter(
            c =>
                costAnalyzer.GoogleCloudFunctionsMemorySizes.find(
                    sz => c.options.memorySize === sz
                ) || c.options.memorySize === 1728
        ),
        ...costAnalyzer.googleConfigurations
    ]);
}

async function compareAws() {
    costAnalyzer.estimateWorkloadCost(require.resolve("./module"), workload, [
        ...costAnalyzer.awsConfigurations.filter(c => c.options.useQueue === false)
    ]);
}

compareAws();

// compareIntersection();

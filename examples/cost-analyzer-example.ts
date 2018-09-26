import { costAnalyzer, Promisified } from "../src/cloudify";
import * as m from "./module";

async function workload(remote: Promisified<typeof m>) {
    await remote.hello("Jorge");
    await remote.randomNumbers(20000000);
}

async function main() {
    costAnalyzer.estimateWorkloadCost(require.resolve("./module"), workload, [
        ...costAnalyzer.awsConfigurations.filter(c =>
            costAnalyzer.GoogleCloudFunctionsMemorySizes.find(
                sz => c.options.memorySize === sz
            )
        ),
        ...costAnalyzer.googleConfigurations
    ]);
}

main();

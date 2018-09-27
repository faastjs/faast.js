import { costAnalyzer, Promisified } from "../src/cloudify";
import * as m from "./module";

async function workload(remote: Promisified<typeof m>) {
    await remote.randomNumbers(20000000);
}

async function compareAws() {
    costAnalyzer.estimateWorkloadCost(require.resolve("./module"), workload, [
        ...costAnalyzer.awsConfigurations.filter(c => c.options.useQueue === false)
    ]);
}

compareAws();

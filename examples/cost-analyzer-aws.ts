import { costAnalyzer, Promisified } from "../src/faast";
import * as m from "./module";

async function workload(remote: Promisified<typeof m>) {
    await remote.randomNumbers(20000000);
}

async function compareAws() {
    costAnalyzer.estimateWorkloadCost(
        require.resolve("./module"),
        workload,
        costAnalyzer.awsConfigurations
    );
}

compareAws();

import { costAnalyzer, Promisified } from "../src/faast";
import * as m from "./module";
import { toCSV } from "../src/cost";
import { writeFile } from "../src/fs";

async function work(remote: Promisified<typeof m>) {
    await remote.randomNumbers(100000000);
}

async function compareAws() {
    const results = await costAnalyzer.estimateWorkloadCost(
        require.resolve("./module"),
        costAnalyzer.awsConfigurations,
        { work }
    );

    await writeFile("cost.csv", toCSV(results));
}

compareAws();

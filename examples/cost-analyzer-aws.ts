import { Promisified, estimateWorkloadCost, awsConfigurations } from "../index";
import * as m from "./functions";
import { toCSV } from "../src/cost";
import { writeFile } from "../src/fs";

async function work(remote: Promisified<typeof m>) {
    await remote.randomNumbers(100000000);
}

async function compareAws() {
    const results = await estimateWorkloadCost(
        require.resolve("./module"),
        awsConfigurations,
        { work }
    );

    await writeFile("cost.csv", toCSV(results));
}

compareAws();

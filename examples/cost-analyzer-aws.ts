import { writeFileSync } from "fs";
import { awsConfigurations, estimateWorkloadCost, Promisified, toCSV } from "../index";
import * as m from "./functions";

async function work(remote: Promisified<typeof m>) {
    await remote.randomNumbers(100000000);
}

async function compareAws() {
    const results = await estimateWorkloadCost(
        m,
        require.resolve("./functions"),
        awsConfigurations,
        { work }
    );

    writeFileSync("cost.csv", toCSV(results));
}

compareAws();

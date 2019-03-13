import { writeFileSync } from "fs";
import { awsConfigurations, estimateWorkloadCost, FaastModule } from "../index";
import * as m from "./functions";

async function work(faastModule: FaastModule<typeof m>) {
    await faastModule.functions.randomNumbers(100000000);
}

async function compareAws() {
    const results = await estimateWorkloadCost(
        m,
        require.resolve("./functions"),
        awsConfigurations,
        { work }
    );

    writeFileSync("cost.csv", results.csv());
}

compareAws();

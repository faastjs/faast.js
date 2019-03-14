import { writeFileSync } from "fs";
import { awsConfigurations, costAnalyzer, FaastModule } from "../index";
import * as mod from "./functions";

async function work(faastModule: FaastModule<typeof mod>) {
    await faastModule.functions.randomNumbers(100000000);
}

async function compareAws() {
    const results = await costAnalyzer(mod, "./functions", { work }, awsConfigurations);

    writeFileSync("cost.csv", results.csv());
}

compareAws();

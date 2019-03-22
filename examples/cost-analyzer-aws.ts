import { writeFileSync } from "fs";
import { CostAnalyzer, FaastModule } from "../index";
import * as mod from "./functions";

async function work(faastModule: FaastModule<typeof mod>) {
    await faastModule.functions.randomNumbers(100000000);
}

async function compareAws() {
    const results = await CostAnalyzer.analyze(
        mod,
        "./functions",
        { work },
        CostAnalyzer.awsConfigurations
    );

    writeFileSync("cost.csv", results.csv());
}

compareAws();

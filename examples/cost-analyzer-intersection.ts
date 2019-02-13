import { costAnalyzer, Promisified } from "../src/faast";
import * as m from "./module";
import { toCSV } from "../src/cost";
import { writeFile } from "../src/fs";

async function work(remote: Promisified<typeof m>) {
    await remote.randomNumbers(100000000);
}

const configurations = [
    ...costAnalyzer.awsConfigurations.filter(c => {
        switch (c.options.memorySize) {
            case 128:
            case 256:
            case 512:
            case 1024:
            case 1728:
            case 2048:
                return true;
            default:
                return false;
        }
    }),
    ...costAnalyzer.googleConfigurations
];

async function compareIntersection() {
    const result = await costAnalyzer.estimateWorkloadCost(
        require.resolve("./module"),
        configurations,
        {
            work
        }
    );

    await writeFile("cost.csv", toCSV(result));
}

compareIntersection();

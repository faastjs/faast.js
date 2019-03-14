import {
    awsConfigurations,
    googleConfigurations,
    costAnalyzer,
    FaastModule
} from "../index";
import * as m from "./functions";
import { writeFile as fsWriteFile } from "fs";
import { promisify } from "util";

const writeFile = promisify(fsWriteFile);

async function work(faastModule: FaastModule<typeof m>) {
    await faastModule.functions.randomNumbers(100000000);
}

const configurations = [
    ...awsConfigurations.filter(c => {
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
    ...googleConfigurations
];

async function compareIntersection() {
    const result = await costAnalyzer(
        m,
        require.resolve("./functions"),
        { work },
        configurations
    );

    await writeFile("cost.csv", result.csv());
}

compareIntersection();

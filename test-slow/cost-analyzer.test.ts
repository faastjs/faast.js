import * as cloudify from "../src/cloudify";
import {
    costAnalyzer,
    CostAnalyzerConfiguration,
    defaulGoogleConfiguration,
    defaultAwsConfiguration,
    toCSV
} from "../src/cost-analyzer";
import * as funcs from "./functions";
import { sum } from "../src/shared";

async function work(remote: cloudify.Promisified<typeof funcs>) {
    await remote.monteCarloPI(20000000);
}

const repetitions = 10;

const configs = [
    {
        ...defaulGoogleConfiguration,
        useQueue: [false],
        repetitions
    },
    {
        ...defaultAwsConfiguration,
        useQueue: [false],
        repetitions
    }
];

test(
    "Cost analyzer",
    async () => {
        const profile = await costAnalyzer("../test-slow/functions", work, configs);

        console.log(toCSV(profile));
        expect(profile.length).toBe(sum(configs.map(o => o.memorySizes.length)));
        profile.forEach(p => {
            expect(p.counters.completed).toBe(repetitions);
            expect(p.counters.errors).toBe(0);
            expect(p.stats.estimatedBilledTimeMs.mean).toBeGreaterThan(0);
            expect(p.costEstimate.estimateTotal()).toBeGreaterThan(0);
        });
    },
    600 * 1000
);

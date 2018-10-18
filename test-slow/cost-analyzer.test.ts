import * as cloudify from "../src/cloudify";
import {
    awsConfigurations,
    estimateWorkloadCost,
    googleConfigurations,
    toCSV
} from "../src/cost-analyzer";
import * as funcs from "./functions";

async function work(remote: cloudify.Promisified<typeof funcs>) {
    await remote.monteCarloPI(20000000);
}

const repetitions = 10;

const configs = [
    ...googleConfigurations.map(c => ({ ...c, repetitions })),
    ...awsConfigurations.map(c => ({ ...c, repetitions }))
];

test(
    "Cost analyzer",
    async () => {
        const profile = await estimateWorkloadCost(
            "../test-slow/functions",
            work,
            configs
        );

        console.log(toCSV(profile));
        expect(profile.length).toBe(configs.length);
        profile.forEach(p => {
            expect(p.counters.completed).toBe(repetitions);
            expect(p.counters.errors).toBe(0);
            expect(p.stats.estimatedBilledTime.mean).toBeGreaterThan(0);
            expect(p.costEstimate.total()).toBeGreaterThan(0);
        });
    },
    600 * 1000
);

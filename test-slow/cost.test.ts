import * as ppp from "papaparse";
import {
    awsConfigurations,
    estimateWorkloadCost,
    googleConfigurations,
    toCSV
} from "../src/cost";
import * as faast from "../src/faast";
import { info } from "../src/log";
import * as funcs from "../test/functions";

async function work(remote: faast.Promisified<typeof funcs>) {
    await remote.monteCarloPI(20000000);
}

const repetitions = 10;
const memorySizes = [128, 2048];

const configs = [...googleConfigurations, ...awsConfigurations]
    .filter(c => memorySizes.includes(c.options.memorySize!))
    .map(c => ({ ...c, repetitions }));

test(
    "Cost analyzer",
    async () => {
        const profile = await estimateWorkloadCost("../test/functions", work, configs, {
            nonTTYRenderer: "silent"
        });

        expect(profile.length).toBe(configs.length);
        for (const p of profile) {
            expect(p.counters.completed).toBe(repetitions);
            expect(p.counters.errors).toBe(0);
            expect(p.stats.estimatedBilledTime.mean).toBeGreaterThan(0);
            expect(p.costEstimate.total()).toBeGreaterThan(0);
        }

        const parsed = ppp.parse(toCSV(profile), {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true
        });
        info(`%O`, parsed.data);
        expect(parsed.data.length).toBe(configs.length);

        for (const row of parsed.data) {
            // cloud,memory,useQueue,options,completed,errors,retries,cost,executionLatency,billedTime
            expect(typeof row.cloud).toBe("string");
            expect(typeof row.memory).toBe("number");
            expect(typeof row.mode).toBe("string");
            expect(typeof row.options).toBe("string");
            expect(typeof row.completed).toBe("number");
            expect(typeof row.errors).toBe("number");
            expect(typeof row.retries).toBe("number");
            expect(typeof row.cost).toBe("string");
            expect(typeof row.executionLatency).toBe("number");
            expect(typeof row.billedTime).toBe("number");
        }
    },
    600 * 1000
);

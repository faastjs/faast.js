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
import test from "ava";

async function work(remote: faast.Promisified<typeof funcs>) {
    await remote.monteCarloPI(20000000);
}

const repetitions = 10;
const memorySizes = [256, 2048];

const configs = [...googleConfigurations, ...awsConfigurations]
    .filter(c => memorySizes.includes(c.options.memorySize!))
    .map(c => ({ ...c, repetitions }));

test("Cost analyzer", async t => {
    const profile = await estimateWorkloadCost(
        "../test/functions",
        configs,
        { work },
        {
            nonTTYRenderer: "silent"
        }
    );

    t.is(profile.length, configs.length);
    for (const p of profile) {
        t.is(p.counters.completed, repetitions);
        t.is(p.counters.errors, 0);
        t.true(p.stats.estimatedBilledTime.mean > 0);
        t.true(p.costEstimate.total() > 0);
    }

    const parsed = ppp.parse(toCSV(profile), {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true
    });
    info(`%O`, parsed.data);
    t.is(parsed.data.length, configs.length);

    for (const row of parsed.data) {
        // cloud,memory,useQueue,options,completed,errors,retries,cost,executionTime,billedTime
        t.is(typeof row.cloud, "string");
        t.is(typeof row.memory, "number");
        t.is(typeof row.mode, "string");
        t.is(typeof row.options, "string");
        t.is(typeof row.completed, "number");
        t.is(typeof row.errors, "number");
        t.is(typeof row.retries, "number");
        t.is(typeof row.cost, "string");
        t.is(typeof row.executionTime, "number");
        t.is(typeof row.billedTime, "number");
    }
});

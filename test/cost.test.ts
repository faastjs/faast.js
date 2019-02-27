import test, { ExecutionContext, Macro } from "ava";
import * as ppp from "papaparse";
import {
    awsConfigurations,
    CommonOptions,
    CostAnalyzerConfiguration,
    estimateWorkloadCost,
    faast,
    googleConfigurations,
    info,
    Promisified,
    Provider,
    providers,
    toCSV
} from "../index";
import * as funcs from "./fixtures/functions";
import { title } from "./fixtures/util";

async function work(remote: Promisified<typeof funcs>) {
    await remote.monteCarloPI(20000000);
}

const repetitions = 10;
const memorySizes = [256, 2048];

function filter(configurations: CostAnalyzerConfiguration[]) {
    return configurations
        .filter(c => memorySizes.includes(c.options.memorySize!))
        .map(c => ({ ...c, repetitions }));
}

const costAnalyzerMacro: Macro<[CostAnalyzerConfiguration[]]> = async (t, configs) => {
    const profile = await estimateWorkloadCost("./fixtures/functions", configs, {
        work,
        silent: true
    });

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
};

export async function testCosts(t: ExecutionContext, provider: Provider) {
    const args: CommonOptions = {
        timeout: 30,
        memorySize: 512,
        mode: "queue",
        maxRetries: 0,
        gc: false
    };
    const cloudFunc = await faast(provider, funcs, "./fixtures/functions", args);

    try {
        await cloudFunc.functions.hello("there");
        const costs = await cloudFunc.costEstimate();

        const { estimatedBilledTime } = cloudFunc.stats.aggregate;
        t.is(
            (estimatedBilledTime.mean * estimatedBilledTime.samples) / 1000,
            costs.metrics.find(m => m.name === "functionCallDuration")!.measured
        );

        t.true(costs.metrics.length > 1);
        t.true(costs.find("functionCallRequests")!.measured === 1);
        let hasPricedMetric = false;
        for (const metric of costs.metrics) {
            if (!metric.informationalOnly) {
                t.true(metric.cost() > 0);
                t.true(metric.measured > 0);
                t.true(metric.pricing > 0);
            }
            hasPricedMetric = true;
            t.true(metric.cost() < 0.00001);
            t.true(metric.name.length > 0);
            t.true(metric.unit.length > 0);
            t.true(metric.cost() === metric.pricing * metric.measured);
        }
        if (hasPricedMetric) {
            t.true(costs.total() >= 0);
        } else {
            t.true(costs.total() === 0);
        }
    } finally {
        await cloudFunc.cleanup();
    }
}

test(title("aws", "cost analyzer"), costAnalyzerMacro, filter(awsConfigurations));
test(title("google", "cost analyzer"), costAnalyzerMacro, filter(googleConfigurations));

for (const provider of providers) {
    test(title(provider, `cost estimate for basic calls`), testCosts, provider);
}

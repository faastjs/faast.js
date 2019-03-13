import test, { ExecutionContext } from "ava";
import * as ppp from "papaparse";
import {
    awsConfigurations,
    CommonOptions,
    CostAnalyzerConfiguration,
    estimateWorkloadCost,
    faast,
    googleConfigurations,
    log,
    Provider,
    providers,
    FaastModule
} from "../index";
import * as funcs from "./fixtures/functions";
import { title } from "./fixtures/util";

async function work(faastModule: FaastModule<typeof funcs>) {
    await faastModule.functions.monteCarloPI(20000000);
}

const repetitions = 10;
const memorySizes = [256, 2048];

function filter(configurations: CostAnalyzerConfiguration[]) {
    return configurations
        .filter(c => memorySizes.includes(c.options.memorySize!))
        .map(c => ({ ...c, repetitions }));
}

async function testCostAnalyzer(
    t: ExecutionContext,
    configs: CostAnalyzerConfiguration[]
) {
    const profile = await estimateWorkloadCost(funcs, "./fixtures/functions", configs, {
        work,
        silent: true
    });

    t.is(profile.estimates.length, configs.length);
    for (const { costSnapshot } of profile.estimates) {
        t.is(costSnapshot.stats.completed, repetitions);
        t.is(costSnapshot.stats.errors, 0);
        t.true(costSnapshot.stats.estimatedBilledTime.mean > 0);
        t.true(costSnapshot.total() > 0);
    }

    const parsed = ppp.parse(profile.csv(), {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true
    });
    log.info(`%O`, parsed.data);
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
}

export async function testCosts(t: ExecutionContext, provider: Provider) {
    const args: CommonOptions = {
        timeout: 30,
        memorySize: 512,
        mode: "queue",
        maxRetries: 0,
        gc: false
    };
    const faastModule = await faast(provider, funcs, "./fixtures/functions", args);

    try {
        await faastModule.functions.hello("there");
        const costs = await faastModule.costSnapshot();

        const { estimatedBilledTime } = faastModule.stats();
        t.is(
            (estimatedBilledTime.mean * estimatedBilledTime.samples) / 1000,
            costs.costMetrics.find(m => m.name === "functionCallDuration")!.measured
        );

        t.true(costs.costMetrics.length > 1);
        t.true(costs.find("functionCallRequests")!.measured === 1);
        let hasPricedMetric = false;
        for (const metric of costs.costMetrics) {
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
        await faastModule.cleanup();
    }
}

test(title("aws", "cost analyzer"), testCostAnalyzer, filter(awsConfigurations));
test(title("google", "cost analyzer"), testCostAnalyzer, filter(googleConfigurations));

for (const provider of providers) {
    test(title(provider, `cost estimate for basic calls`), testCosts, provider);
}

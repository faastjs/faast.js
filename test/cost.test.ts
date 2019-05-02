import test, { ExecutionContext } from "ava";
import * as ppp from "papaparse";
import {
    CommonOptions,
    faast,
    FaastModule,
    log,
    Provider,
    providers,
    CostAnalyzer
} from "../index";
import * as funcs from "./fixtures/functions";
import { title } from "./fixtures/util";

async function work(faastModule: FaastModule<typeof funcs>) {
    await faastModule.functions.monteCarloPI(20000000);
}

const repetitions = 10;
const memorySizes = [1024, 2048];

function filter(configurations: CostAnalyzer.Configuration[]) {
    return configurations
        .filter(c => memorySizes.includes(c.options.memorySize!))
        .map(c => ({ ...c, repetitions }));
}

async function testCostAnalyzer(
    t: ExecutionContext,
    configurations: CostAnalyzer.Configuration[]
) {
    const profile = await CostAnalyzer.analyze({
        funcs,
        work,
        configurations,
        silent: true
    });
    t.is(profile.estimates.length, configurations.length);
    for (const { costSnapshot } of profile.estimates) {
        t.true(costSnapshot.stats.completed > 0, `completed > 0`);
        t.is(costSnapshot.stats.errors, 0, `errors === 0`);
        t.true(costSnapshot.stats.estimatedBilledTime.mean > 0, `billed time > 0`);
        t.true(costSnapshot.total() > 0, `total > 0`);
    }

    const parsed = ppp.parse(profile.csv(), {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true
    });
    log.info(`%O`, parsed.data);
    t.is(parsed.data.length, configurations.length);

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
        gc: "off"
    };
    const faastModule = await faast(provider, funcs, args);

    try {
        await faastModule.functions.hello("there");
        const costs = await faastModule.costSnapshot();

        const { estimatedBilledTime } = faastModule.stats();
        t.is(
            (estimatedBilledTime.mean * estimatedBilledTime.samples) / 1000,
            costs.costMetrics.find(m => m.name === "functionCallDuration")!.measured
        );

        t.true(costs.costMetrics.length > 1, "cost metrics exist");
        t.true(
            costs.find("functionCallRequests")!.measured === 1,
            "functionCallRequests === 1"
        );
        const output = costs.toString();
        const csvOutput = costs.csv();
        let hasPricedMetric = false;
        for (const metric of costs.costMetrics) {
            t.regex(output, new RegExp(metric.name));
            t.regex(csvOutput, new RegExp(metric.name));
            if (!metric.informationalOnly) {
                t.true(metric.cost() > 0, `${metric.name}.cost() > 0`);
                t.true(metric.measured > 0, `${metric.name}.measured > 0`);
                t.true(metric.pricing > 0, `${metric.name}.pricing > 0`);
            }
            hasPricedMetric = true;
            t.true(metric.cost() < 0.00001, `${metric.name}.cost() < 0.00001`);
            t.true(metric.name.length > 0, `${metric.name}.length > 0`);
            t.true(metric.unit.length > 0, `${metric.name}.unit.length > 0`);
            t.true(
                metric.cost() === metric.pricing * metric.measured,
                `${metric.name} cost is computed correctly`
            );
        }
        if (hasPricedMetric) {
            t.true(costs.total() >= 0, `costs.total > 0 (hasPricedMetric)`);
        } else {
            t.true(costs.total() === 0, `costs.total === 0 (!hasPricedMetric)`);
        }
    } finally {
        await faastModule.cleanup();
    }
}

const { awsConfigurations, googleConfigurations } = CostAnalyzer;
test(title("aws", "cost analyzer"), testCostAnalyzer, filter(awsConfigurations));
test(title("google", "cost analyzer"), testCostAnalyzer, filter(googleConfigurations));

for (const provider of providers) {
    test(title(provider, `cost estimate for basic calls`), testCosts, provider);
}

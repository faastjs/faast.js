import test, { ExecutionContext } from "ava";
import { inspect } from "util";
import * as awsFaast from "../src/aws/aws-faast";
import * as faast from "../src/faast";
import { faastify, Provider } from "../src/faast";
import { info } from "../src/log";
import { CommonOptions } from "../src/provider";
import { Statistics } from "../src/shared";
import * as funcs from "./functions";
import { configs, providers, title } from "./util";

async function testBasic(
    t: ExecutionContext,
    provider: "aws",
    options: awsFaast.Options
): Promise<void>;
async function testBasic(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
): Promise<void>;
async function testBasic(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
): Promise<void> {
    const opts = { timeout: 30, memorySize: 512, gc: false, ...options };
    const cloudFunc = await faastify(provider, funcs, "./functions", opts);
    const remote = cloudFunc.functions;

    try {
        t.is(await remote.hello("Andy"), "Hello Andy!");
        t.is(await remote.identity("你好"), "你好");
        t.is(await remote.fact(5), 120);
        t.is(await remote.concat("abc", "def"), "abcdef");
        await t.throwsAsync(() => remote.error("hey"), /Expected error. Arg: hey/);
        t.is(await remote.noargs(), "called function with no args.");
        t.is(await remote.async(), "async function: success");
        t.is(typeof (await remote.path()), "string");
        t.is(await remote.optionalArg(), "No arg");
        t.is(await remote.optionalArg("has arg"), "has arg");
        try {
            await remote.emptyReject();
            t.fail("remote.emptyReject() did not reject as expected");
        } catch (err) {
            t.is(err, undefined);
        }
        try {
            await remote.rejected();
            t.fail("remote.rejected() did not reject as expected");
        } catch (err) {
            t.is(err, "intentionally rejected");
        }
        await t.throwsAsync(() => remote.promiseArg(Promise.resolve()), /not supported/);
    } finally {
        await cloudFunc.cleanup();
    }
}

export async function testCosts(t: ExecutionContext, provider: faast.Provider) {
    const args: CommonOptions = {
        timeout: 30,
        memorySize: 512,
        mode: "queue",
        maxRetries: 0,
        gc: false
    };
    const cloudFunc = await faastify(provider, funcs, "./functions", args);

    try {
        await cloudFunc.functions.hello("there");
        const costs = await cloudFunc.costEstimate();
        info(`${costs}`);
        info(`CSV costs:\n${costs.csv()}`);

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

async function testCpuMetrics(t: ExecutionContext, provider: faast.Provider) {
    t.plan(4);

    const lambda = await faastify(provider, funcs, "./functions", {
        childProcess: true,
        timeout: 90,
        memorySize: 512,
        maxRetries: 0,
        gc: false
    });

    try {
        const NSec = 4;
        await lambda.functions.spin(NSec * 1000);
        const usage = lambda.cpuUsage.get("spin");
        t.truthy(usage);
        t.true(usage!.size > 0);
        for (const [, instance] of usage!) {
            t.true(instance.stime instanceof Statistics);
            t.true(instance.utime instanceof Statistics);
            break;
        }
    } finally {
        await lambda.cleanup();
    }
}

for (const provider of providers) {
    for (const config of configs) {
        test(title(provider, `basic calls`, config), testBasic, provider, config);
    }
    test(title(provider, `cost estimate for basic calls`), testCosts, provider);
    test(title(provider, `cpu metrics are received`), testCpuMetrics, provider);
}

const hOpts: faast.aws.Options = {
    mode: "https",
    packageJson: "test/fixtures/package.json",
    useDependencyCaching: false
};
test(title("aws", `basic calls`, hOpts), testBasic, "aws", hOpts);

const qOpts: faast.aws.Options = {
    mode: "queue",
    packageJson: "test/fixtures/package.json",
    useDependencyCaching: false
};
test(title("aws", `basic calls`, qOpts), testBasic, "aws", qOpts);

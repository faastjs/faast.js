import test, { ExecutionContext } from "ava";
import { inspect } from "util";
import * as awsFaast from "../src/aws/aws-faast";
import * as faast from "../src/faast";
import { faastify } from "../src/faast";
import { info, warn } from "../src/log";
import { CommonOptions } from "../src/provider";
import { Statistics } from "../src/shared";
import { configs, providers } from "./configurations";
import * as funcs from "./functions";
import { macros, once } from "./util";

export function testFunctions(provider: "aws", options: awsFaast.Options): void;
export function testFunctions(provider: "local", options: faast.local.Options): void;
export function testFunctions(provider: faast.Provider, options: CommonOptions): void;
export function testFunctions(provider: faast.Provider, options: CommonOptions): void {
    let cloudFunc: faast.CloudFunction<typeof funcs>;
    let remote: faast.Promisified<typeof funcs>;
    const opts = inspect(options, { breakLength: Infinity });

    const init = async () => {
        try {
            const start = Date.now();
            const opts = { timeout: 30, memorySize: 512, gc: false, ...options };
            cloudFunc = await faastify(provider, funcs, "./functions", opts);
            remote = cloudFunc.functions;
            info(`Function creation took ${((Date.now() - start) / 1000).toFixed(1)}s`);
        } catch (err) {
            warn(err);
        }
    };
    const cleanup = () => cloudFunc && cloudFunc.cleanup();
    const title = (name?: string) => `${provider} ${name} ${opts}`;
    const { eq, reject, rejectError } = macros(init, title, cleanup);

    test(`hello`, eq, () => remote.hello("Andy"), "Hello Andy!");
    test(`multibyte characters`, eq, () => remote.identity("你好"), "你好");
    test(`factorial`, eq, () => remote.fact(5), 120);
    test(`concat`, eq, () => remote.concat("abc", "def"), "abcdef");
    test(`exception`, rejectError, () => remote.error("hey"), /Expected error. Arg: hey/);
    test(`no arguments`, eq, () => remote.noargs(), "called function with no args.");
    test(`async function`, eq, () => remote.async(), "async function: success");
    test(`get $PATH`, eq, async () => typeof (await remote.path()), "string");
    test(`optional arg absent`, eq, () => remote.optionalArg(), "No arg");
    test(`optional arg present`, eq, () => remote.optionalArg("has arg"), "has arg");
    test(`empty promise rejection`, reject, () => remote.emptyReject(), undefined);
    test(`rejected promise`, reject, () => remote.rejected(), "intentionally rejected");

    const p = Promise.resolve();
    test(`no promise args`, rejectError, () => remote.promiseArg(p), /not supported/);
}

export function testCosts(provider: faast.Provider, options: CommonOptions = {}) {
    let cloudFunc: faast.CloudFunction<typeof funcs>;
    const opts = inspect(options, { breakLength: Infinity });

    const init = once(async () => {
        const args: CommonOptions = {
            timeout: 30,
            memorySize: 512,
            mode: "queue",
            maxRetries: 0,
            gc: false
        };
        cloudFunc = await faastify(provider, funcs, "./functions", {
            ...args,
            ...options
        });
    });

    test.after.always(() => cloudFunc && cloudFunc.cleanup());

    test(`${provider} cost for basic call ${opts}`, async t => {
        await init();
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
    });
}

export function testCpuMetrics(provider: faast.Provider, options: CommonOptions = {}) {
    const opts = inspect(options, { breakLength: Infinity });
    let lambda: faast.CloudFunction<typeof funcs>;

    const init = async () => {
        lambda = await faastify(provider, funcs, "./functions", {
            childProcess: true,
            timeout: 30,
            memorySize: 512,
            maxRetries: 0,
            gc: false,
            ...options
        });
    };

    const cleanup = () => lambda && lambda.cleanup();
    const title = (name?: string) => `${provider} ${name} ${opts}`;
    const { fn } = macros(init, title, cleanup);

    test(`cpu metrics are received`, fn, async (t: ExecutionContext) => {
        await init();
        const NSec = 5;
        await lambda.functions.spin(NSec * 1000);
        const usage = lambda.cpuUsage.get("spin");
        t.truthy(usage);
        t.true(usage!.size > 0);
        t.true(usage!.get(1)!.stime instanceof Statistics);
        t.true(usage!.get(1)!.utime instanceof Statistics);
    });
}

for (const provider of providers) {
    for (const config of configs) {
        testFunctions(provider, config);
    }
    testCosts(provider);
    testCpuMetrics(provider);
}

testFunctions("aws", {
    mode: "https",
    packageJson: "test/package.json",
    useDependencyCaching: false
});

testFunctions("aws", {
    mode: "queue",
    packageJson: "test/package.json",
    useDependencyCaching: false
});

import test, { ExecutionContext } from "ava";
import { inspect } from "util";
import * as faast from "../src/faast";
import { faastify } from "../src/faast";
import { info } from "../src/log";
import { CommonOptions } from "../src/provider";
import { Statistics } from "../src/shared";
import { providers, configs } from "./configurations";
import * as funcs from "./functions";
import { testFunctions } from "./tests";
import { once, macros } from "./util";

export function testCosts(provider: faast.Provider, options: CommonOptions = {}) {
    let cloudFunc: faast.CloudFunction<typeof funcs>;
    const opts = inspect(options, { breakLength: Infinity });

    const init = once(async () => {
        const args: CommonOptions = {
            timeout: 30,
            memorySize: 512,
            mode: "queue",
            gc: false
        };
        cloudFunc = await faastify(provider, funcs, "./functions", {
            ...args,
            ...options
        });
    });

    test.after.always(() => cloudFunc && cloudFunc.cleanup());

    test(`${provider} ${opts} cost for basic call`, async t => {
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

export function testCpuMetrics(provider: faast.Provider, options?: CommonOptions) {
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
        const N = 5;
        const NSec = 5;
        const promises: Promise<unknown>[] = [];
        for (let i = 0; i < N; i++) {
            promises.push(lambda.functions.spin(NSec * 1000));
        }
        await Promise.all(promises);
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

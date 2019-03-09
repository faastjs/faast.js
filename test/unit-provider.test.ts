import { FunctionStats, FunctionCounters } from "../index";
import test from "ava";
import { keys } from "../src/shared";

test(`FunctionStats clone`, t => {
    const fstats = new FunctionStats();

    fstats.executionTime.update(100);
    fstats.estimatedBilledTime.update(101);
    fstats.localStartLatency.update(102);
    fstats.remoteStartLatency.update(103);
    fstats.returnLatency.update(104);
    fstats.sendResponseLatency.update(105);

    const cloned = fstats.clone();
    t.deepEqual(cloned, fstats);
    for (const key of keys(cloned)) {
        t.true(cloned[key] !== fstats[key]);
    }
    t.is(cloned.toString(), fstats.toString());

    cloned.estimatedBilledTime.update(0);
    t.notDeepEqual(cloned, fstats);
    t.notDeepEqual(cloned.estimatedBilledTime, fstats.estimatedBilledTime);
    t.true(cloned.toString() !== fstats.toString());
});

test(`FunctionCounters clone`, t => {
    const fcounters = new FunctionCounters();
    fcounters.completed = 10;
    fcounters.errors = 1;
    fcounters.invocations = 11;
    fcounters.retries = 2;

    const clone = fcounters.clone();
    t.deepEqual(clone, fcounters);

    clone.completed++;
    t.true(clone.completed !== fcounters.completed);
});

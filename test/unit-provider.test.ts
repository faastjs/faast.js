import { FunctionStats } from "../index";
import test from "ava";
import { keysOf } from "../src/shared";

test(`FunctionStats clone`, t => {
    const stats = new FunctionStats();

    stats.executionTime.update(100);
    stats.estimatedBilledTime.update(101);
    stats.localStartLatency.update(102);
    stats.remoteStartLatency.update(103);
    stats.returnLatency.update(104);
    stats.sendResponseLatency.update(105);
    stats.completed = 10;
    stats.errors = 1;
    stats.invocations = 11;
    stats.retries = 2;

    const cloned = stats.clone();
    t.deepEqual(cloned, stats);
    for (const key of keysOf(cloned)) {
        if (typeof cloned[key] !== "number") {
            t.true(cloned[key] !== stats[key]);
        }
    }
    t.is(cloned.toString(), stats.toString());

    cloned.executionTime.update(0);
    t.notDeepEqual(cloned, stats);
    t.notDeepEqual(cloned.executionTime, stats.executionTime);
    t.true(cloned.toString() !== stats.toString());
    cloned.completed++;
    t.true(cloned.completed !== stats.completed);
});

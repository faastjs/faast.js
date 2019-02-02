import { Statistics } from "../src/shared";
import { deepCopyUndefined } from "../src/wrapper";
import { avg, stdev } from "./util";
import test, { Assertions } from "ava";

test("shared module deepCopyUndefined copies undefined properties", t => {
    const obj = { prop: undefined };
    const obj2 = {};
    deepCopyUndefined(obj2, obj);
    t.deepEqual(obj2, obj);
});

test("shared module deepCopyUndefined copies nested undefined properties", t => {
    const obj = { outer: { inner: undefined } };
    const obj2 = { outer: {} };
    deepCopyUndefined(obj2, obj);
    t.deepEqual(obj2, obj);
});

test("shared module deepCopyUndefined should not hang on cyclical references", t => {
    const obj = { ref: {} };
    obj.ref = obj;

    const obj2 = { ref: {} };
    obj2.ref = obj2;

    deepCopyUndefined(obj2, obj);
    t.deepEqual(obj2, obj);
});

test("shared module deep copy should not fail when objects are not shaped similarly", t => {
    const obj = { geometry: { theorem: { name: "Pythagorean" } } };
    const obj2 = { hypothesis: "Riemann" };
    t.notThrows(() => deepCopyUndefined(obj2, obj));
});

function check(t: Assertions, values: number[]) {
    const stat = new Statistics();
    values.forEach(value => stat.update(value));
    t.true(Math.abs(stat.mean - avg(values)) < 0.000000001);
    t.true(Math.abs(stat.stdev - stdev(values)) < 0.000000001);
    t.is(stat.samples, values.length);
}

test("statistics shared module empty values", t => {
    const emptyStat = new Statistics();
    t.is(emptyStat.mean, NaN);
    t.is(emptyStat.stdev, 0);
    t.is(emptyStat.samples, 0);
});

test("statistics shared module single values", t => {
    check(t, [0]);
    check(t, [1]);
    check(t, [-1]);
    check(t, [0.5]);
    check(t, [-0.5]);
    check(t, [0.1]);
    check(t, [-0.1]);
});

test("statistics shared module multiple values", t => {
    check(t, [0, 1]);
    check(t, [0, 1, 2]);
    check(t, [42, 100, 1000]);
    check(t, [1, 0.1]);
    check(t, [-0.5, 0.5]);
    check(t, [-1, 1]);
    check(t, [3.14159, 2.717]);
});

test("statistics shared module random values", t => {
    const a = [];
    const b = [];
    const c = [];
    for (let i = 0; i < 1000; i++) {
        a.push(Math.random());
        b.push(Math.random() * 10);
        c.push(Math.random() * 100);
    }
    check(t, a);
    check(t, b);
    check(t, c);
});

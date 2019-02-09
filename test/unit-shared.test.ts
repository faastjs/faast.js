import { Statistics, Heap, LargestN } from "../src/shared";
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

test("heap basics", t => {
    const h = new Heap();
    h.insert(5);
    h.insert(10);
    h.insert(100);
    h.insert(1);

    t.is(h.extractMin(), 1);
    t.is(h.extractMin(), 5);
    t.is(h.extractMin(), 10);
    t.is(h.extractMin(), 100);
    t.throws(() => h.extractMin(), /empty/);
});

test("heap empty", t => {
    const h = new Heap();
    t.throws(() => h.extractMin(), /empty/);
});

test("heap sorting", t => {
    const h = new Heap();
    const N = 10000;
    const size = 100;

    for (let attempt = 0; attempt < N; attempt++) {
        let orig: number[] = [];
        const a: number[] = [];
        for (let i = 0; i < size; i++) {
            const value = Math.round(Math.random() * 1000);
            a.push(value);
            h.insert(value);
        }
        orig = a.slice();
        a.sort((x, y) => x - y);
        const b = [];
        while (h.size > 0) {
            b.push(h.extractMin());
        }
        t.deepEqual(a, b, `difference sorting ${orig}`);
    }
});

test("heap specific ordering", t => {
    const h = new Heap();
    h.insert(7);
    h.insert(2);
    h.insert(0);
    h.insert(3);
    h.insert(4);
    h.insert(1);
    h.insert(6);
    h.insert(5);

    t.is(h.extractMin(), 0);
    t.is(h.extractMin(), 1);
    t.is(h.extractMin(), 2);
    t.is(h.extractMin(), 3);
    t.is(h.extractMin(), 4);
    t.is(h.extractMin(), 5);
    t.is(h.extractMin(), 6);
    t.is(h.extractMin(), 7);
});

test("heap iterator", t => {
    const h = new Heap();
    h.insert(42);
    h.insert(10);
    h.insert(12);
    t.deepEqual([...h], [10, 42, 12]);
});

test("largestn saves largest N keys", t => {
    const l = new LargestN(3);
    l.update(100);
    l.update(42);
    l.update(-1);
    l.update(0);
    l.update(4);
    l.update(1000);
    t.deepEqual(l.keys(), [42, 100, 1000]);
});

test("largestn saves largest N values", t => {
    const N = 3;
    const l = new LargestN<string>(N);
    l.update(100, "100");
    l.update(42, "42");
    l.update(-1, "-1");
    l.update(0, "0");
    l.update(4, "4");
    l.update(1000, "1000");
    t.deepEqual([...l], [[100, "100"], [42, "42"], [1000, "1000"]]);
});

test("largestn duplicate values", t => {
    const N = 5;
    const l = new LargestN<string>(N);
    l.update(8, "8.1");
    l.update(8, "8.2");
    l.update(8, "8.3");
    l.update(42, "42");
    l.update(8, "8.4");
    l.update(8, "8.5");
    l.update(8, "8.6");
    l.update(10, "10.1");
    l.update(10, "10.2");
    l.update(8, "8.7");
    l.update(8, "8.8");
    t.deepEqual([...l], [[8, "8.1"], [8, "8.2"], [42, "42"], [10, "10.1"], [10, "10.2"]]);
});

import { Statistics, MaxHeap, SmallestN } from "../src/shared";
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

test("MaxHeap basics", t => {
    const h = new MaxHeap();
    h.insert(5);
    h.insert(10);
    h.insert(100);
    h.insert(1);

    t.is(h.extractMax(), 100);
    t.is(h.extractMax(), 10);
    t.is(h.extractMax(), 5);
    t.is(h.extractMax(), 1);
    t.throws(() => h.extractMax(), /empty/);
});

test("MaxHeap empty", t => {
    const h = new MaxHeap();
    t.throws(() => h.extractMax(), /empty/);
});

test("MaxHeap sorting", t => {
    const h = new MaxHeap();
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
        a.sort((x, y) => y - x);
        const b = [];
        while (h.size > 0) {
            b.push(h.extractMax());
        }
        t.deepEqual(a, b, `difference sorting ${orig}`);
    }
});

test("MaxHeap specific ordering", t => {
    const h = new MaxHeap();
    h.insert(7);
    h.insert(2);
    h.insert(0);
    h.insert(3);
    h.insert(4);
    h.insert(1);
    h.insert(6);
    h.insert(5);

    t.is(h.extractMax(), 7);
    t.is(h.extractMax(), 6);
    t.is(h.extractMax(), 5);
    t.is(h.extractMax(), 4);
    t.is(h.extractMax(), 3);
    t.is(h.extractMax(), 2);
    t.is(h.extractMax(), 1);
    t.is(h.extractMax(), 0);
});

test("MaxHeap iterator", t => {
    const h = new MaxHeap();
    h.insert(10);
    h.insert(42);
    h.insert(12);
    t.deepEqual([...h], [42, 10, 12]);
});

test("SmallestN saves smallest N keys", t => {
    const s = new SmallestN(3);
    s.update(100);
    s.update(42);
    s.update(-1);
    s.update(0);
    s.update(4);
    s.update(1000);
    t.deepEqual(s.keys().sort(), [-1, 0, 4].sort());
});

test("SmallestN saves smallest N values", t => {
    const N = 3;
    const s = new SmallestN<string>(N);
    s.update(100, "100");
    s.update(42, "42");
    s.update(-1, "-1");
    s.update(0, "0");
    s.update(4, "4");
    s.update(1000, "1000");
    t.deepEqual([...s], [[-1, "-1"], [0, "0"], [4, "4"]]);
});

test("SmallestN duplicate values", t => {
    const N = 5;
    const s = new SmallestN<string>(N);
    s.update(88, "88.1");
    s.update(88, "88.2");
    s.update(88, "88.3");
    s.update(42, "42");
    s.update(88, "88.4");
    s.update(88, "88.5");
    s.update(88, "88.6");
    s.update(10, "10.1");
    s.update(10, "10.2");
    s.update(88, "88.7");
    s.update(88, "88.8");
    t.deepEqual(
        [...s],
        [[88, "88.1"], [88, "88.2"], [42, "42"], [10, "10.1"], [10, "10.2"]]
    );
});

function values(a: number[]): [number, undefined][] {
    return a.map(i => [i, undefined] as [number, undefined]);
}

test("SmallestN can reduce size", t => {
    const N = 5;
    const s = new SmallestN(N);
    s.update(1);
    s.update(2);
    s.update(3);
    s.update(4);
    s.update(5);
    s.update(6);
    s.update(7);

    s.setSize(3);
    t.deepEqual([...s], values([1, 2, 3]));
});

test("SmallestN can increase size", t => {
    const N = 3;
    const s = new SmallestN(N);
    s.update(1);
    s.update(2);
    s.update(3);
    s.update(4);
    s.update(5);
    t.deepEqual([...s], values([1, 2, 3]));

    s.setSize(5);
    s.update(6);
    s.update(7);
    s.update(8);
    t.deepEqual([...s], values([1, 2, 3, 6, 7]));
});

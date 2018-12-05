import { Statistics } from "../src/shared";
import { deepCopyUndefined } from "../src/wrapper";
import { avg, stdev } from "./util";

describe("shared module tests", () => {
    test("Copy of undefined properties", () => {
        const obj = { prop: undefined };
        const obj2 = {};
        deepCopyUndefined(obj2, obj);
        expect(obj2).toEqual(obj);
    });

    test("Deep copy of undefined properties", () => {
        const obj = { outer: { inner: undefined } };
        const obj2 = { outer: {} };
        deepCopyUndefined(obj2, obj);
        expect(obj2).toEqual(obj);
    });

    test("Deep copy of undefined properties should not infinitely recurse on cyclical references", () => {
        const obj = { ref: {} };
        obj.ref = obj;

        const obj2 = { ref: {} };
        obj2.ref = obj2;

        deepCopyUndefined(obj2, obj);
        expect(obj2).toEqual(obj);
    });

    test("Deep copy should not fail when objects are not shaped similarly", () => {
        const obj = { geometry: { theorem: { name: "Pythagorean" } } };
        const obj2 = { hypothesis: "Riemann" };
        deepCopyUndefined(obj2, obj);
    });

    function check(values: number[]) {
        const stat = new Statistics();
        values.forEach(value => stat.update(value));
        expect(stat.mean).toBeCloseTo(avg(values), 10);
        expect(stat.stdev).toBeCloseTo(stdev(values), 10);
        expect(stat.samples).toBe(values.length);
    }

    describe("statistics", () => {
        test("empty values", () => {
            const emptyStat = new Statistics();
            expect(emptyStat.mean).toBeNaN();
            expect(emptyStat.stdev).toBe(0);
            expect(emptyStat.samples).toBe(0);
        });
        test("single values", () => {
            check([0]);
            check([1]);
            check([-1]);
            check([0.5]);
            check([-0.5]);
            check([0.1]);
            check([-0.1]);
        });
        test("multiple values", () => {
            check([0, 1]);
            check([0, 1, 2]);
            check([42, 100, 1000]);
            check([1, 0.1]);
            check([-0.5, 0.5]);
            check([-1, 1]);
            check([3.14159, 2.717]);
        });
        test("random values", () => {
            const a = [];
            const b = [];
            const c = [];
            for (let i = 0; i < 1000; i++) {
                a.push(Math.random());
                b.push(Math.random() * 10);
                c.push(Math.random() * 100);
            }
            check(a);
            check(b);
            check(c);
        });
    });
});

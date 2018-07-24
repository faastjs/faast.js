import { Statistics } from "../src/shared";
import { avg, stdev } from "./util";

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
        expect(emptyStat.stdev).toBeNaN();
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

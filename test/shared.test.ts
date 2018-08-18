import { deepCopyUndefined } from "../src/trampoline";

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

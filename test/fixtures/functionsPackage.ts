import { map } from "lodash";

export function squareLodash(a: number[]) {
    return map(a, i => i * i);
}

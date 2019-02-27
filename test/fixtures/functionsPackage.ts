import _ from "lodash";

export function squareLodash(a: number[]) {
    return _.map(a, i => i * 2);
}

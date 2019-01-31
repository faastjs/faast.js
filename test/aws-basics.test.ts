import { testFunctions, testCancellation } from "./tests";
import { CommonOptions } from "../src/provider";

const configs: CommonOptions[] = [
    { mode: "https", childProcess: false },
    { mode: "https", childProcess: true },
    { mode: "queue", childProcess: false },
    { mode: "queue", childProcess: true }
];

describe.each(configs)("aws with options %p", (options: CommonOptions) => {
    testFunctions("aws", options);
    testCancellation("aws", options);
});

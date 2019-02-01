import { testFunctions, testCancellation } from "./tests";
import { CommonOptions } from "../src/provider";
import { _providers } from "../src/faast";
import { keys } from "../src/shared";

const configs: CommonOptions[] = [
    { mode: "https", childProcess: false },
    { mode: "https", childProcess: true },
    { mode: "queue", childProcess: false },
    { mode: "queue", childProcess: true }
];

const providers = keys(_providers);

for (const provider of providers) {
    for (const config of configs) {
        testFunctions(provider, config);
        testCancellation(provider, config);
    }
}

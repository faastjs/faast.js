import { _providers } from "../src/faast";
import { CommonOptions } from "../src/provider";
import { keys } from "../src/shared";

export const configs: CommonOptions[] = [
    { mode: "https", childProcess: false },
    { mode: "https", childProcess: true },
    { mode: "queue", childProcess: false },
    { mode: "queue", childProcess: true }
];

export const providers = keys(_providers);

import { faast } from "faastjs";
import * as funcs from "./functions";

(async () => {
    const m = await faast("aws", funcs, "./functions");
    await m.functions.hello("world");
    const cost = await m.costSnapshot();
    console.log(`hello world cost: $${cost.total()}`);
    // hello world cost: $0.0000030596957398557663
    await m.cleanup();
})();

import { faast } from "faastjs";
import * as funcs from "./functions";

(async () => {
    const m = await faast("aws", funcs, "./functions");
    const promises = [];
    // Summon 1000 cores
    for (let i = 0; i < 1000; i++) {
        promises.push(m.functions.hello("world " + i));
    }
    await Promise.all(promises);
    await m.cleanup();
})();

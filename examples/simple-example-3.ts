import { faast } from "../index";
import * as funcs from "./functions";

(async () => {
    // Create lambda functions, IAM roles, queues, etc.
    const m = await faast("aws", funcs, "./functions", {
        memorySize: 256,
        timeout: 30,
        concurrency: 1000
    });
    const promises = [];
    // Call hello() in parallel.
    for (let i = 0; i < 1000; i++) {
        promises.push(m.functions.hello("world " + i));
    }
    const results = await Promise.all(promises);
    // Remove infrastructure.
    await m.cleanup();

    console.log(results);
})();

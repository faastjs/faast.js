import { faast } from "../index";
import * as funcs from "./functions";

(async () => {
    const m = await faast("aws", funcs, "./functions");
    const result = await m.functions.hello("world");
    await m.cleanup();

    console.log(result);
})();

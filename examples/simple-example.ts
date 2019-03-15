import { faast } from "../index";
import * as funcs from "./functions";

async function main() {
    const faastModule = await faast("aws", funcs, "./functions");
    try {
        const remote = faastModule.functions;
        console.log(await remote.hello("world"));
    } finally {
        await faastModule.cleanup();
    }
}

main();

import { cloudify } from "../src/cloudify";
import * as m from "./module";

async function main() {
    const { cloudFunc, remote } = await cloudify("aws", m, "./module");
    const result = await remote.hello("there");
    console.log(result);
    const cost = await cloudFunc.costEstimate();
    console.log(`${cost}`);
    await cloudFunc.cleanup();
}

main();

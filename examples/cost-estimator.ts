import { cloudify } from "../src/cloudify";
import * as m from "./module";

async function main() {
    const { hello, __cloudify } = await cloudify("aws", m, "./module");
    const result = await hello("there");
    console.log(result);
    await __cloudify.cleanup();
}

main();

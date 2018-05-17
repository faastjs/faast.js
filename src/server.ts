import debug from "debug";
import { registerFunction } from "./functionserver";
import { concat, fact, hello } from "./shared";

const log = debug("cloudify");

registerFunction(fact);
registerFunction(hello);
registerFunction(concat);
log(`Registered functions`);

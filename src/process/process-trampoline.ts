import * as childProcess from "child_process";
import * as process from "process";
import { FunctionCall } from "../shared";

process.on("message", (call: FunctionCall) => {});

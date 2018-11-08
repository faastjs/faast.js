import { checkFunctions } from "./tests";

checkFunctions("Queue trigger", "aws", { mode: "queue" });
checkFunctions("Queue trigger", "aws", { mode: "queue", childProcess: true });

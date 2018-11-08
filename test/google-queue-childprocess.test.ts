import { checkFunctions } from "./tests";

checkFunctions("Queue trigger with child process", "google", {
    mode: "queue",
    childProcess: true
});

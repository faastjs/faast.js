import { checkFunctions } from "./tests";

checkFunctions("Https trigger with child process", "google", {
    mode: "https",
    childProcess: true
});

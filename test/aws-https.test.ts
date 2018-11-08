import { checkFunctions } from "./tests";

checkFunctions("Https trigger", "aws", { mode: "https" });
checkFunctions("Https trigger", "aws", { mode: "https", childProcess: true });

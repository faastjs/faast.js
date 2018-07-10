import { checkFunctions } from "./tests";

checkFunctions("Queue trigger", "aws", { useQueue: true });
checkFunctions("Https trigger", "aws", { useQueue: false });

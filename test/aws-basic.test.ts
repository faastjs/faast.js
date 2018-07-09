import { checkFunctions } from "./tests";

checkFunctions("Queue trigger", "aws");
checkFunctions("Https trigger", "aws", { useQueue: false });

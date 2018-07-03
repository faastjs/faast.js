import { checkFunctions } from "./functions-expected";

checkFunctions("Queue trigger", "aws");
checkFunctions("Https trigger", "aws", { useQueue: false });

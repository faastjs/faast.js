import { checkFunctions } from "./shared";

checkFunctions("Queue trigger", "aws");
checkFunctions("Https trigger", "aws", { useQueue: false });

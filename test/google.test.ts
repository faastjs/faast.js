import { checkFunctions } from "./functions-expected";

checkFunctions("Queue trigger", "google");
checkFunctions("Https trigger", "google", { useQueue: false });

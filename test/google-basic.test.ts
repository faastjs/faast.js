import { checkFunctions } from "./tests";

checkFunctions("Queue trigger", "google");
checkFunctions("Https trigger", "google", { useQueue: false });

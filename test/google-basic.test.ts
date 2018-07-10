import { checkFunctions } from "./tests";

checkFunctions("Queue trigger", "google", { useQueue: true });
checkFunctions("Https trigger", "google", { useQueue: false });

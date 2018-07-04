import { checkFunctions } from "./shared";

checkFunctions("Queue trigger", "google");
checkFunctions("Https trigger", "google", { useQueue: false });

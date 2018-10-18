import { checkFunctions } from "./tests";

checkFunctions("Https trigger with package.json", "aws", {
    mode: "https",
    packageJson: "test/package.json",
    useDependencyCaching: false
});

checkFunctions("Queue trigger with package.json", "aws", {
    mode: "queue",
    packageJson: "test/package.json",
    useDependencyCaching: false
});

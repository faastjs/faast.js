import { checkFunctions } from "./tests";

checkFunctions("Https trigger with package.json", "aws", {
    useQueue: false,
    packageJson: "test/package.json",
    useDependencyCaching: false
});

checkFunctions("Queue trigger with package.json", "aws", {
    useQueue: true,
    packageJson: "test/package.json",
    useDependencyCaching: false
});

import { checkFunctions } from "./tests";

checkFunctions("Https trigger with package.json", "aws", {
    useQueue: false,
    packageJson: "test/package.json"
});

checkFunctions("Queue trigger with package.json", "aws", {
    useQueue: true,
    packageJson: "test/package.json"
});

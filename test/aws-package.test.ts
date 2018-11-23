import { checkFunctions } from "./tests";

describe("aws with package.json", () => {
    describe("https trigger", () =>
        checkFunctions("aws", {
            mode: "https",
            packageJson: "test/package.json",
            useDependencyCaching: false
        }));

    describe("queue trigger", () =>
        checkFunctions("aws", {
            mode: "queue",
            packageJson: "test/package.json",
            useDependencyCaching: false
        }));
});

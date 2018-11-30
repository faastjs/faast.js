import { testFunctions } from "./tests";

describe("aws with package.json", () => {
    describe("https trigger", () =>
        testFunctions("aws", {
            mode: "https",
            packageJson: "test/package.json",
            useDependencyCaching: false
        }));

    describe("queue trigger", () =>
        testFunctions("aws", {
            mode: "queue",
            packageJson: "test/package.json",
            useDependencyCaching: false
        }));
});

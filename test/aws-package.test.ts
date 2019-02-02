import { testFunctions } from "./tests";

testFunctions("aws", {
    mode: "https",
    packageJson: "test/package.json",
    useDependencyCaching: false
});

testFunctions("aws", {
    mode: "queue",
    packageJson: "test/package.json",
    useDependencyCaching: false
});

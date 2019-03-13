import test from "ava";
import { faast, throttle } from "../index";
import { topPackages } from "./top-packages";

const testPackage = throttle({ concurrency: 500 }, async (pkg: string) => {
    try {
        const faastModule = await faast(
            "aws",
            require("../test/fixtures/functions"),
            "../test/fixtures/functions",
            {
                mode: "https",
                useDependencyCaching: false,
                packageJson: { dependencies: { [pkg]: "*" } },
                gc: false
            }
        );
        await faastModule.cleanup();
        return pkg;
    } catch (err) {
        return err as Error;
    }
});

function testPackages(packages: string[]) {
    for (const pkg of packages) {
        test(`top package ${pkg}`, async t => {
            const rv = await testPackage(pkg);
            t.is(rv, pkg);
        });
    }
}

// funnel(500) => 468s
// funnel(900) => 504s
testPackages(topPackages);
// testPackages(topPackagesFailures);

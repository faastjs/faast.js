import test from "ava";
import { v4 as uuid } from "uuid";
import { faastAws } from "../index";
import { checkResourcesCleanedUp } from "./fixtures/util";
import { getAWSResources } from "./fixtures/util-aws";
import * as funcs from "./fixtures/functions";

test("remote aws cleanup removes ephemeral resources", async t => {
    const func = await faastAws(funcs, {
        mode: "queue",
        gc: "off",
        description: t.title
    });
    await func.cleanup({ deleteCaches: true });
    await checkResourcesCleanedUp(t, await getAWSResources(func));
});

test("remote aws cleanup removes lambda layers", async t => {
    const func = await faastAws(funcs, {
        packageJson: {
            name: uuid(),
            version: "0.0.2",
            description: "aws cleanup layer test",
            repository: "foo",
            license: "ISC",
            dependencies: {
                "chrome-aws-lambda": "latest",
                "puppeteer-core": "latest"
            }
        },
        gc: "off",
        description: t.title
    });
    await func.cleanup({ deleteCaches: true });
    await checkResourcesCleanedUp(t, await getAWSResources(func));
});

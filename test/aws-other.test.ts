import test from "ava";
import { faastAws } from "../index";
import * as funcs from "./fixtures/functions";
import { title } from "./fixtures/util";

test(title("aws", `AWS Lambda ARM architecture`), async t => {
    const faastModule = await faastAws(funcs, {
        timeout: 20,
        gc: "off",
        description: t.title,
        packageJson: {
            sharp: "*"
        },
        awsLambdaOptions: {
            Architectures: ["arm64"]
        }
    });
    const remote = faastModule.functions;

    try {
        t.is(await remote.hello("Andy"), "Hello Andy!");
    } finally {
        await faastModule.cleanup();
    }
});

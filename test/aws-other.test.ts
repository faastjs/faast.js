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

test(title("aws", `AWS Lambda node18 runtime`), async t => {
    const faastModule = await faastAws(funcs, {
        timeout: 20,
        gc: "off",
        description: t.title,
        packageJson: {},
        awsLambdaOptions: {
            Runtime: "nodejs18.x"
        },
        // Required for node18.x, so we can use aws-sdk v2 in the function.
        webpackAwsSdk: true
    });
    const remote = faastModule.functions;

    try {
        t.is(await remote.hello("Andy"), "Hello Andy!");
    } finally {
        await faastModule.cleanup();
    }
});

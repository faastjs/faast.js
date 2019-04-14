import test, { ExecutionContext } from "ava";
import { Lambda } from "aws-sdk";
import * as uuid from "uuid/v4";
import { AwsLayerInfo, npmInstall } from "../src/aws/aws-npm";
import { title } from "./fixtures/util";

const lambda = new Lambda({ region: "us-west-2" });

async function testNpmInstall(
    t: ExecutionContext,
    packageJsonContents: string,
    bigPackage: boolean
) {
    const LayerName = `faast-test-layer-${uuid()}`;
    const FunctionName = `faast-${uuid()}`;
    let layerInfo: AwsLayerInfo | undefined;
    let installLog: string;
    try {
        const result = await npmInstall({
            LayerName,
            FunctionName,
            packageJsonContents,
            region: "us-west-2",
            quiet: true
        });
        if (bigPackage) {
            t.true(result.zipSize! > 50 * 2 ** 20);
        }
        ({ layerInfo, installLog } = result);
        t.is(layerInfo.LayerName, LayerName);
        t.true(typeof layerInfo.Version === "number");
        t.regex(installLog, /added [0-9]+ package/);
    } finally {
        if (layerInfo) {
            await lambda
                .deleteLayerVersion({ LayerName, VersionNumber: layerInfo.Version })
                .promise();
        }
    }
}

const puppeteerPackage = JSON.stringify({
    dependencies: {
        "chrome-aws-lambda": "latest",
        "puppeteer-core": "latest",
        typescript: "latest",
        "aws-sdk": "latest",
        googleapis: "latest"
    }
});

test.serial(
    title("aws", `npm-install with Lambda Layer larger than 50MB`),
    testNpmInstall,
    puppeteerPackage,
    true
);

const tslibPackage = JSON.stringify({
    dependencies: {
        tslib: "latest"
    }
});

test.serial(
    title("aws", "npm-install with Lambda Layer less than 50MB"),
    testNpmInstall,
    tslibPackage,
    false
);

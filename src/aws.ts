import * as aws from "aws-sdk";
import humanStringify from "human-stringify";
import { SSL_OP_TLS_BLOCK_PADDING_BUG } from "constants";

const lambda = new aws.Lambda({ apiVersion: "2015-03-31" });
lambda.createFunction({
    FunctionName: "cloudify-XXX",
    Runtime: "nodejs6.10",
    Handler: "trampoline",
    Code: {
        ZipFile: new Buffer("")
    },
    Description: "cloudfy trampoline function",
    Timeout: 60,
    MemorySize: 128,
    Publish: true,
    DeadLetterConfig: { TargetArn: "XXX" }
});

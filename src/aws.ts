import * as aws from "aws-sdk";
import humanStringify from "human-stringify";

const lambda = new aws.Lambda({ apiVersion: "2015-03-31" });
console.log(humanStringify(lambda));

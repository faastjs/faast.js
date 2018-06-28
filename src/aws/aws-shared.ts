import * as aws from "aws-sdk";
import { log } from "../log";
import { sleep } from "../shared";
import { quietly } from "./aws-cloudify";

export async function pollAWSRequest<T>(
    n: number,
    description: string,
    fn: () => aws.Request<T, aws.AWSError>
) {
    await sleep(2000);
    let success = false;
    for (let i = 0; i < n; i++) {
        log(`Polling ${description}...`);
        const result = await quietly(fn());
        if (result) {
            return result;
        }
        await sleep(1000);
    }
    throw new Error("Polling failed for ${description}");
}

import * as awssdk from "aws-sdk";
import * as cloudify from "../src/cloudify";
import { BoundedFunnel } from "../src/funnel";
import * as funcs from "../test-slow/functions";
import { sleep } from "../src/shared";
import { rejected } from "../test/functions";
import { awsPrice } from "../src/aws/aws-cloudify";

const pricing = new awssdk.Pricing({ region: "us-east-1" });

async function printAWSServices() {
    const services = await pricing.describeServices().promise();
    // services.Services!.forEach(service =>
    //     console.log(`${service.ServiceCode}: ${service.AttributeNames}`)
    // );
    return services.Services!;
}

async function printAWSServiceAttributes(service: string, attributes: string[]) {
    console.log(`${service} Attributes: `);
    for (const attr of attributes) {
        await new Promise((resolve, reject) => {
            pricing
                .getAttributeValues({ ServiceCode: service, AttributeName: attr })
                .eachPage((err, response) => {
                    if (err) {
                        reject(err);
                    }
                    if (response === null) {
                        resolve();
                        return true;
                    }
                    response.AttributeValues!.forEach(val =>
                        console.log(`${attr}: ${val.Value}`)
                    );
                    return true;
                });
        });
    }
}

async function main() {
    const services = await printAWSServices();
    // const service = services.find(s => s.ServiceCode === "AmazonSNS")!;
    // const service = services.find(s => s.ServiceCode === "AWSQueueService")!;
    const service = services.find(s => s.ServiceCode === "AWSDataTransfer")!;

    await printAWSServiceAttributes(service.ServiceCode!, service.AttributeNames!);

    const result = await pricing
        .getProducts({
            ServiceCode: service.ServiceCode!,
            Filters: [
                { Field: "transferType", Type: "TERM_MATCH", Value: "AWS Outbound" },
                { Field: "fromLocation", Type: "TERM_MATCH", Value: "US East (Ohio)" }
                // { Field: "queueType", Type: "TERM_MATCH", Value: "Standard" }
                // { Field: "endpointType", Type: "TERM_MATCH", Value: "AWS Lambda" }
                // { Field: "productFamily", Type: "TERM_MATCH", Value: "API Request" }
                // { Field: "group", Type: "TERM_MATCH", Value: "" }
                // { Field: "location", Type: "TERM_MATCH", Value: regions[region] }
            ]
        })
        .promise();

    console.log(`Price: %O`, result.PriceList!);
}

main();

// interface CostResult {
//     MB: number;
//     msec: number;
//     perRequest: number;
//     perGbSecond: number;
//     price: number;
// }

// async function measureCostEstimator(fmodule: string, options: cloudify.aws.Options) {
//     const funnel = new BoundedFunnel<CostResult>({
//         maxConcurrency: 5,
//         targetRequestsPerSecond: 2,
//         maxBurst: 1
//     });
//     for (let memorySize = 128; memorySize <= 3008; memorySize += 64) {
//         funnel.push(() => estimateAWSCost(fmodule, { memorySize, ...options }));
//     }
//     const results = await funnel.all();

//     results.forEach(price =>
//         console.log(
//             `(${price.MB}MB / 1024) * (${
//                 price.msec
//             }ms / 1000) * \$${price.perGbSecond.toFixed(
//                 8
//             )}/GB-second + ${price.perRequest.toFixed(
//                 8
//             )}/request = \$${price.price.toFixed(8)}`
//         )
//     );
// }

// measureCostEstimator("../test-slow/functions", { useQueue: false }).catch(err =>
//     console.log(err)
// );

// import { cloudbilling_v1 } from "googleapis";
// import * as cloudify from "../src/cloudify";
// import CloudBilling = cloudbilling_v1;
// import { warn } from "../src/log";

// async function main() {
//     const services = await cloudify.google.initializeGoogleServices();
//     const pricing = await getGoogleCloudFunctionsPricing(services.cloudBilling);
// }

// main();

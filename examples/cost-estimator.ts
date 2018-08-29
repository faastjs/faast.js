// import * as awssdk from "aws-sdk";
// import * as cloudify from "../src/cloudify";
// import { BoundedFunnel } from "../src/funnel";
// import * as funcs from "../test-slow/functions";
// import { sleep } from "../src/shared";

// const pricing = new awssdk.Pricing({ region: "us-east-1" });

// async function printLambdaAttributes() {
//     const lambdaAttributes = ["location", "servicecode", "usagetype", "group"];

//     console.log(`Attributes: `);
//     const promises = lambdaAttributes.map(async attr => {
//         const attrValues = await pricing
//             .getAttributeValues({ ServiceCode: "AWSLambda", AttributeName: attr })
//             .promise();
//         attrValues.AttributeValues!.forEach(val => console.log(`${attr}: ${val.Value}`));
//     });

//     await Promise.all(promises);
// }

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

import { cloudbilling_v1 } from "googleapis";
import * as cloudify from "../src/cloudify";
import CloudBilling = cloudbilling_v1;

async function getGoogleCloudFunctionsPricing(cloudBilling: CloudBilling.Cloudbilling) {
    const services = await cloudBilling.services.list();
    // services.data.services!.forEach(service => console.log(`%O`, service));
    const cloudFunctionsService = services.data.services!.find(
        service => service.displayName === "Cloud Functions"
    )!;
    const skusResponse = await cloudBilling.services.skus.list({
        parent: cloudFunctionsService.name
    });
    const { skus = [] } = skusResponse.data;
    console.log("%O", skus);
    const perInvocation = skus.find(
        sku => sku.description === "Invocations" && sku.serviceRegions![0] === "global"
    )!;
    const perGhzSecond = skus.find(
        sku => sku.description === "CPU Time" && sku.serviceRegions![0] === "global"
    )!;
    const perGbSecond = skus.find(
        sku => sku.description === "Memory Time" && sku.serviceRegions![0] === "global"
    )!;

    return {
        perInvocation: perInvocation.pricingInfo,
        perGhzSecond: perGhzSecond.pricingInfo,
        perGbSecond: perGbSecond.pricingInfo
    };
    // cloudBilling.services.skus.list({ parent: "" });
}

async function main() {
    const services = await cloudify.google.initializeGoogleServices();
    const pricing = await getGoogleCloudFunctionsPricing(services.cloudBilling);
    console.log(`%O`, pricing);
}

main();

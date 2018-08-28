import * as aws from "aws-sdk";

async function main() {
    const pricing = new aws.Pricing({ region: "us-east-1" });

    const services = await pricing
        .describeServices({ ServiceCode: "AWSLambda" })
        .promise();

    console.log(`AWS Pricing - Services A`);
    services.Services!.forEach(s => console.log(`${s.ServiceCode}: ${s.AttributeNames}`));

    const lambdaAttributes = services.Services![0].AttributeNames || [];

    console.log(`Attributes: `);
    const promises = lambdaAttributes.map(async attr => {
        const attrValues = await pricing
            .getAttributeValues({ ServiceCode: "AWSLambda", AttributeName: attr })
            .promise();
        attrValues.AttributeValues!.forEach(val => console.log(`${attr}: ${val.Value}`));
    });

    await Promise.all(promises);

    console.log();
    console.log(`AWS Pricing - Products`);

    pricing.getProducts().eachPage((_, data) => {
        data && data.PriceList!.forEach(name => console.log(name));
        return true;
    });
}

main();

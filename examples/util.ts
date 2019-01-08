import * as aws from "aws-sdk";
const s3 = new aws.S3();

export async function listAllObjects(Bucket: string) {
    const allObjects: aws.S3.Object[] = [];
    await new Promise(resolve =>
        s3.listObjectsV2({ Bucket }).eachPage((err, data) => {
            if (err) {
                console.warn(err);
                return false;
            }
            if (data) {
                allObjects.push(...data.Contents!);
            } else {
                resolve();
            }
            return true;
        })
    );
    return allObjects;
}

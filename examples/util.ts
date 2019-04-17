import { S3 } from "aws-sdk";
const s3 = new S3();

export async function listAllObjects(Bucket: string) {
    const allObjects: S3.Object[] = [];
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

export const GB = 2 ** 30;
export const MB = 2 ** 20;
export const KB = 2 ** 10;

export function f1(n: number) {
    return n.toFixed(1);
}

export function f2(n: number) {
    return n.toFixed(2);
}

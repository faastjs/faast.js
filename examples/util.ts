import { S3, _Object, paginateListObjectsV2 } from "@aws-sdk/client-s3";

const s3Client = new S3({ region: "us-west-2" });

export async function listAllObjects(Bucket: string): Promise<_Object[]> {
    const allObjects: _Object[] = [];
    for await (const obj of paginateListObjectsV2({ client: s3Client }, { Bucket })) {
        allObjects.push(...(obj.Contents ?? []));
    }
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

import * as archiver from "archiver";
import { Lambda, S3 } from "aws-sdk";
import * as sys from "child_process";
import { writeFile, ensureDir, remove } from "fs-extra";
import { tmpdir } from "os";
import * as path from "path";
import { streamToBuffer } from "../shared";
import { inspect } from "util";

export function exec(log: (_: string) => void, cmds: string[]) {
    let rv = "";
    for (const cmd of cmds) {
        try {
            rv += sys.execSync(cmd).toString();
        } catch (err) {
            rv += err.message;
        }
    }
    log(rv);
    return rv;
}

export interface NpmInstallArgs {
    packageJsonContents: string;
    LayerName: string;
    FunctionName: string;
    region: string;
    quiet?: boolean;
}

export interface AwsLayerInfo {
    Version: number;
    LayerVersionArn: string;
    LayerName: string;
}

export interface NpmInstallReturn {
    installLog: string;
    layerInfo: AwsLayerInfo;
    zipSize?: number;
}

export async function npmInstall({
    LayerName,
    packageJsonContents,
    FunctionName,
    region,
    quiet
}: NpmInstallArgs): Promise<NpmInstallReturn> {
    const log = quiet ? (_: string) => {} : console.log;

    log(
        `*** This faast invocation is an internal lambda call used when the packageJson option is specified to createFunction(). ***`
    );
    log(
        `*** Its purpose is to create a node_modules package and cache it, then combine with user code to form an AWS Lambda code package and upload it to S3 ***`
    );

    const buildParentDir = path.join(tmpdir(), FunctionName);
    const buildDir = path.join(buildParentDir, "nodejs");
    await ensureDir(buildDir);
    await writeFile(path.join(buildDir, "package.json"), packageJsonContents);

    let installLog = "";
    log("Checking cache");
    log(`Checking faast layers for ${LayerName}`);
    const lambda = new Lambda({ apiVersion: "2015-03-31", region });

    const cached = await lambda
        .listLayerVersions({ LayerName, CompatibleRuntime: "nodejs" })
        .promise()
        .catch(_ => {});

    if (cached && cached.LayerVersions && cached.LayerVersions.length > 0) {
        const layerVersion = cached.LayerVersions[0];
        const layerInfo = {
            LayerName,
            Version: layerVersion.Version!,
            LayerVersionArn: layerVersion.LayerVersionArn!
        };
        log(`CACHED, ${inspect(layerInfo)}`);
        return { installLog, layerInfo };
    }

    log("NOT CACHED, running npm install");
    const npmQuiet = quiet ? "-s" : "";
    installLog += exec(log, [`echo "hello world"`]);
    installLog += exec(log, [
        `export HOME=/tmp; npm install --prefix=${buildDir} --no-package-lock ${npmQuiet}`
    ]);
    log(`Running archiver`);
    const cacheArchive = archiver("zip", { zlib: { level: 8 } });
    cacheArchive.directory(buildParentDir, false).finalize();
    log(`Converting archive to buffer`);
    const ZipFile = await streamToBuffer(cacheArchive);
    log(`Code ZipFile size: ${ZipFile.length}`);
    log(`Removing ${buildParentDir}`);
    const removePromise = remove(buildParentDir);
    let Content: Lambda.LayerVersionContentInput | undefined;
    const Bucket = FunctionName;
    const s3 = new S3({ region });
    const zipSize = ZipFile.length;
    try {
        if (ZipFile.length > 50 * 2 ** 20) {
            // Try to use S3 to allow for a larger limit
            log(`Creating s3 bucket ${Bucket}`);
            await s3
                .createBucket({ Bucket })
                .promise()
                .catch(_ => {});
            log(`Uploading bucket: ${Bucket}, object: ${LayerName}`);
            await s3.upload({ Bucket, Key: LayerName, Body: ZipFile }).promise();
            Content = { S3Bucket: Bucket, S3Key: LayerName };
        } else {
            Content = { ZipFile };
        }
        log(`Creating lambda layer: ${LayerName}, zip file size: ${ZipFile.length}`);
        const publishResponse = await lambda
            .publishLayerVersion({
                LayerName,
                Description: `faast packageJson layer with LayerName ${LayerName}`,
                Content,
                CompatibleRuntimes: ["nodejs"]
            })
            .promise();
        const { Version } = publishResponse;
        log(`Created lambda layer: ${LayerName}:${Version}`);
        log(`DONE`);
        return {
            installLog,
            layerInfo: {
                LayerName,
                LayerVersionArn: publishResponse.LayerVersionArn!,
                Version: publishResponse.Version!
            },
            zipSize
        };
    } finally {
        if (Content && Content.S3Bucket) {
            try {
                await s3.deleteObject({ Bucket, Key: LayerName }).promise();
                await s3.deleteBucket({ Bucket }).promise();
            } catch {}
        }
        await removePromise;
    }
}

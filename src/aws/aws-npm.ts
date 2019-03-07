import * as archiver from "archiver";
import { Lambda } from "aws-sdk";
import * as sys from "child_process";
import { writeFile, ensureDir } from "fs-extra";
import { tmpdir } from "os";
import * as path from "path";
import { streamToBuffer } from "../shared";

export function exec(cmds: string[]) {
    let rv = "";
    for (const cmd of cmds) {
        rv += sys.execSync(cmd).toString();
    }
    console.log(rv);
    return rv;
}

const buildDir = path.join(tmpdir(), "build", "nodejs");
const lambda = new Lambda({ apiVersion: "2015-03-31" });

export interface NpmInstallArgs {
    packageJsonContents: string;
    LayerName: string;
}

export interface AwsLayerInfo {
    Version: number;
    LayerVersionArn: string;
    LayerName: string;
}

export interface NpmInstallReturn {
    installLog: string;
    layerInfo: AwsLayerInfo;
}

export async function npmInstall({
    LayerName,
    packageJsonContents
}: NpmInstallArgs): Promise<NpmInstallReturn> {
    console.log(
        `*** This faast invocation is an internal lambda call used when the packageJson option is specified to createFunction(). ***`
    );
    console.log(
        `*** Its purpose is to create a node_modules package and cache it, then combine with user code to form an AWS Lambda code package and upload it to S3 ***`
    );
    await ensureDir(buildDir);
    await writeFile(path.join(buildDir, "package.json"), packageJsonContents);

    let installLog = "";
    console.log("Checking cache");
    console.log(`Checking faast layers for ${LayerName}`);

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
        console.log("CACHED, %O", layerInfo);
        return { installLog, layerInfo };
    }

    console.log("NOT CACHED, running npm install");
    installLog += exec([`export HOME=/tmp && npm install --prefix=${buildDir}`]);
    console.log(`Running archiver`);
    const cacheArchive = archiver("zip", { zlib: { level: 8 } });
    cacheArchive.directory(path.dirname(buildDir), false).finalize();

    const ZipFile = await streamToBuffer(cacheArchive);
    console.log(`Creating lambda layer: ${LayerName}, zip file size: ${ZipFile.length}`);
    const publishResponse = await lambda
        .publishLayerVersion({
            LayerName,
            Description: `faast packageJson layer with LayerName ${LayerName}`,
            Content: { ZipFile },
            CompatibleRuntimes: ["nodejs"]
        })
        .promise();
    const { Version } = publishResponse;
    console.log(`Created lambda layer: ${LayerName}:${Version}`);
    console.log(`DONE`);
    return {
        installLog,
        layerInfo: {
            LayerName,
            LayerVersionArn: publishResponse.LayerVersionArn!,
            Version: publishResponse.Version!
        }
    };
}

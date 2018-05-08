import Axios from "axios";
import { Request, Response } from "express";
import * as fs from "fs";
import { GoogleApis, cloudfunctions_v1 as gcf } from "googleapis";
import humanStringify from "human-stringify";
import { googlePagedIterator, initializeGoogleAPIs, poll, unwrap } from "./shared";

const zone = "us-west1-a";

export class CloudFunctions {
    gCloudFunctions: gcf.Cloudfunctions;
    project: string;

    constructor(google: GoogleApis, project: string) {
        this.gCloudFunctions = google.cloudfunctions("v1");
        this.project = project;
    }

    async waitFor(operation: string | gcf.Schema$Operation) {
        const name = typeof operation === "string" ? operation : operation.name!;
        return poll({
            request: () => this.getOperation(name),
            checkDone: result => result.done || true,
            operation: name,
            verbose: true
        });
    }

    getOperation(name: string) {
        return unwrap(this.gCloudFunctions.operations.get({ name }));
    }

    async *listOperations(name: string) {
        yield* googlePagedIterator(pageToken =>
            this.gCloudFunctions.operations.list({ name, pageToken })
        );
    }

    async *listLocations(name: string) {
        yield* googlePagedIterator(pageToken =>
            this.gCloudFunctions.projects.locations.list({ name, pageToken })
        );
    }

    callFunction(path: string, data?: string) {
        return unwrap(
            this.gCloudFunctions.projects.locations.functions.call({
                name: path,
                requestBody: { data }
            })
        );
    }

    async createFunction(location: string, func: gcf.Schema$CloudFunction) {
        const operation = await this.gCloudFunctions.projects.locations.functions.create(
            {
                location,
                requestBody: func
            },
            {}
        );

        return this.waitFor(operation.data);
    }

    async deleteFunction(path: string) {
        const response = await this.gCloudFunctions.projects.locations.functions.delete({
            name: path
        });

        return this.waitFor(response.data);
    }

    generateDownloadUrl(name: string, versionId?: string) {
        return unwrap(
            this.gCloudFunctions.projects.locations.functions.generateDownloadUrl({
                name,
                requestBody: { versionId }
            })
        );
    }

    async generateUploaddUrl(parent: string) {
        return unwrap(
            this.gCloudFunctions.projects.locations.functions.generateUploadUrl({
                parent
            })
        );
    }

    getFunction(name: string) {
        return unwrap(this.gCloudFunctions.projects.locations.functions.get({ name }));
    }

    async *listFunctions(parent: string) {
        yield* googlePagedIterator(pageToken =>
            this.gCloudFunctions.projects.locations.functions.list({
                parent,
                pageToken
            })
        );
    }

    locationPath(location: string) {
        return `projects/${this.project}/locations/${location}`;
    }

    functionPath(location: string, funcname: string) {
        return `projects/${this.project}/locations/${location}/functions/${funcname}`;
    }

    async patchFunction(
        name: string,
        updateMask: string,
        func: gcf.Schema$CloudFunction
    ) {
        const response = await this.gCloudFunctions.projects.locations.functions.patch({
            name,
            updateMask,
            requestBody: func
        });
        return this.waitFor(response.data);
    }

    async createFunctionWithZipFile(
        locationName: string,
        funcName: string,
        zipFile: string,
        description: string,
        entryPoint: string,
        timeout?: number,
        availableMemoryMb?: number
    ) {
        console.log(`Create cloud function`);
        const funcPath = this.functionPath(locationName, funcName);
        const locationPath = this.locationPath(locationName);
        console.log(`  funcPath: ${funcPath}`);
        console.log(`  locationPath: ${locationPath}`);
        const uploadUrlResponse = await this.generateUploaddUrl(locationPath);
        console.log(`upload URL: ${uploadUrlResponse.uploadUrl}, zipFile: ${zipFile}`);
        // upload ZIP file to uploadUrlResponse.uploadUrl
        const putResult = await Axios.put(
            uploadUrlResponse.uploadUrl!,
            fs.createReadStream(zipFile),
            {
                headers: {
                    "content-type": "application/zip",
                    "x-goog-content-length-range": "0,104857600"
                }
            }
        );

        console.log(`Put response: ${putResult.statusText}`);

        console.log(`creating function`);

        const functionRequest: gcf.Schema$CloudFunction = {
            name: funcPath,
            description,
            entryPoint,
            timeout: `${timeout}s`,
            availableMemoryMb,
            sourceUploadUrl: uploadUrlResponse.uploadUrl,
            httpsTrigger: { url: "" }
        };
        console.log(
            `Create function: locationPath: ${locationPath}, ${humanStringify(
                functionRequest
            )}`
        );
        await this.createFunction(locationPath, functionRequest);
    }
}

export async function main() {
    const google = await initializeGoogleAPIs();
    const project = await google.auth.getDefaultProjectId();
    const cloudFunctions = new CloudFunctions(google, project);

    const locationName = "us-central1";
    //const locationName = "us-west1";
    const funcName = "foo";
    const zipFile = "dist.zip";
    const description = `Example cloud function`;
    const entryPoint = "entry";
    const timeout = 60;
    const availableMemoryMb = 512;
    const funcPath = cloudFunctions.functionPath(locationName, funcName);

    console.log(`Creating cloud function ${funcName}`);
    await cloudFunctions
        .createFunctionWithZipFile(
            locationName,
            funcName,
            zipFile,
            description,
            entryPoint,
            timeout,
            availableMemoryMb
        )
        .catch(err => console.error(err.message));

    console.log(`Listing cloud functions:`);
    const responses = cloudFunctions.listFunctions(cloudFunctions.locationPath("-"));
    for await (const response of responses) {
        const functions = response.functions || [];
        for (const func of functions) {
            console.log(humanStringify(func, { maxDepth: 1 }));
        }
    }

    console.log(`Calling cloud function ${funcName}`);
    const callResponse = await cloudFunctions.callFunction(funcPath, "Andy");

    console.log(`Response: ${callResponse.result}`);

    console.log(`Deleting cloud function ${funcName}`);
    await cloudFunctions.deleteFunction(funcPath);

    console.log(`Done.`);
}

import Axios, { AxiosPromise } from "axios";
import * as fs from "fs";
import { GoogleApis, cloudfunctions_v1 as gcf, google } from "googleapis";
import humanStringify from "human-stringify";

export async function initializeGoogleAPIs() {
    const auth = await google.auth.getClient({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });

    const project = await google.auth.getDefaultProjectId();
    google.options({ auth });
    return google;
}

export function logFields<O, K extends keyof O>(obj: O, keys: K[]) {
    console.group();
    for (const key of keys) {
        console.log(`${key}: ${humanStringify(obj[key])}`);
    }
    console.groupEnd();
}

export function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export interface PollOptions {
    maxRetries?: number;
    verbose?: boolean;
    operation?: string;
    delay?: (retries: number) => Promise<void>;
}

export interface PollConfig<T> extends PollOptions {
    request: () => Promise<T>;
    checkDone: (result: T) => boolean;
    describe?: (result: T) => string;
}

export async function defaultPollDelay(_retries: number) {
    return sleep(5 * 1000);
}

export function defaultDescribe<T>(result: T) {
    return humanStringify(result, { maxDepth: 1 });
}

export async function poll<T>({
    request,
    checkDone,
    describe = defaultDescribe,
    delay = defaultPollDelay,
    maxRetries = 10,
    verbose = false,
    operation = ""
}: PollConfig<T>): Promise<T | undefined> {
    let retries = 0;
    await delay(retries);
    while (true) {
        verbose && console.log(`Polling "${operation}"`);
        const result = await request();
        verbose &&
            describe &&
            console.log(`Polling "${operation}" response: ${describe(result)}`);
        if (checkDone(result)) {
            verbose && console.log(`Polling "${operation}" complete.`);
            return result;
        }
        if (retries++ >= maxRetries) {
            verbose &&
                console.log(`Polling "${operation}" timed out after ${retries} attempts`);
            return;
        }
        verbose && console.log(`Polling "${operation}" not complete, retrying...`);
        await delay(retries);
    }
}

interface HasNextPageToken {
    nextPageToken?: string;
}

export async function* googlePagedIterator<T extends HasNextPageToken>(
    request: (token: string | undefined) => AxiosPromise<T>
): AsyncIterableIterator<T> {
    let pageToken: string | undefined;
    do {
        const result = await request(pageToken);
        pageToken = result.data.nextPageToken;
        yield result.data;
    } while (pageToken);
}

export async function unwrap<T>(promise: AxiosPromise<T>) {
    let result = await promise;
    return result.data;
}

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
            timeout: `${timeout || 60}s`,
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

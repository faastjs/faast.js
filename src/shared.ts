import { google } from "googleapis";
import humanStringify from "human-stringify";
import { AxiosPromise, AxiosResponse } from "axios";

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

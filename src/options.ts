import * as webpack from "webpack";

export interface PackerOptions {
    webpackOptions?: webpack.Configuration;
    packageJson?: string | object | false;
    addDirectory?: string | string[];
    addZipFile?: string | string[];
}

export interface CommonOptions extends PackerOptions {
    childProcess?: boolean;
    concurrency?: number;
    gc?: boolean;
    maxRetries?: number;
    memorySize?: number;
    mode?: "https" | "queue" | "auto";
    retentionInDays?: number;
    speculativeRetryThreshold?: number;
    timeout?: number;
}

export const CommonOptionDefaults: Required<CommonOptions> = {
    childProcess: false,
    concurrency: 100,
    gc: true,
    maxRetries: 2,
    memorySize: 1024,
    mode: "auto",
    retentionInDays: 1,
    speculativeRetryThreshold: 3,
    timeout: 60,
    webpackOptions: {},
    packageJson: false,
    addDirectory: [],
    addZipFile: []
};

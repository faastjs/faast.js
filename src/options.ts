import * as webpack from "webpack";

export interface PackerOptions {
    addDirectory?: string | string[];
    addZipFile?: string | string[];
    packageJson?: string | object | false;
    webpackOptions?: webpack.Configuration;
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
    addDirectory: [],
    addZipFile: [],
    childProcess: false,
    concurrency: 100,
    gc: true,
    maxRetries: 2,
    memorySize: 1024,
    mode: "auto",
    packageJson: false,
    retentionInDays: 1,
    speculativeRetryThreshold: 3,
    timeout: 60,
    webpackOptions: {}
};

export interface CleanupOptions {
    deleteResources?: boolean;
}

export const CleanupOptionDefaults: Required<CleanupOptions> = {
    deleteResources: true
};

export interface FunctionCall {
    name: string;
    args: any[];
    CallId: string;
    ResponseQueueUrl?: string;
}

export interface FunctionReturn {
    type: "returned" | "error";
    value?: any;
    CallId: string;
}

export function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export type Mutable<T> = { -readonly [key in keyof T]: T[key] };

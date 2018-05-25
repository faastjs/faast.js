import { createHash } from "crypto";
import { create } from "archiver";
export {
    CloudifyGoogle,
    CloudifyGoogleOptions,
    packGoogleCloudFunction
} from "./google/google-cloudify";
export {
    CloudifyAWS,
    CloudifyAWSOptions,
    packAWSLambdaFunction
} from "./aws/aws-cloudify";

export type AnyFunction = (...args: any[]) => any;

export type Unpacked<T> = T extends Promise<infer U> ? U : T;

export type PromisifiedFunction<T extends AnyFunction> =
    // prettier-ignore
    T extends () => infer U ? () => Promise<Unpacked<U>> :
    T extends (a1: infer A1) => infer U ? (a1: A1) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2) => infer U ? (a1: A1, a2: A2) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3) => infer U ? (a1: A1, a2: A2, a3: A3) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4) => infer U ? (a1: A1, a2: A2, a3: A3, a4: A4) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5) => infer U ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6) => infer U ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6, a7: infer A7) => infer U ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6, a7: infer A7, a8: infer A8) => infer U ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7, a8: A8) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6, a7: infer A7, a8: infer A8, a9: infer A9) => infer U ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7, a8: A8, a9: A9) => Promise<Unpacked<U>> :
    T extends (...args: any[]) => infer U ? (...args: any[]) => Promise<Unpacked<U>> : T;

export type Promisified<T> = {
    [K in keyof T]: T[K] extends AnyFunction ? PromisifiedFunction<T[K]> : never
};

export interface CloudFunctionService {
    name: string;
    cloudify<F extends AnyFunction>(fn: F): PromisifiedFunction<F>;
    cloudifyAll<M>(importedModule: M): Promisified<M>;
    cleanup(): Promise<void>;
}

export interface FunctionCall {
    name: string;
    args: any[];
}

export interface FunctionReturn {
    type: "returned" | "error";
    value?: any;
}

export function getConfigHash(codeHash: string, options: object) {
    const hasher = createHash("sha256");
    const nonce = `${Math.random()}`.replace(".", "");
    hasher.update(JSON.stringify({ nonce, codeHash, options }));
    return hasher.digest("hex");
}

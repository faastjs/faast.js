import { createHash } from "crypto";

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

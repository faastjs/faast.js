export interface FunctionCall {
    name: string;
    args: any[];
    CallId: string;
}

export interface FunctionReturn {
    type: "returned" | "error";
    value?: any;
    CallId: string;
}

import * as asyncHooks from "async_hooks";
import { inspect } from "util";

let hook: () => void | undefined;

type AsyncState = "init" | "before" | "after" | "destroyed" | "resolved";

interface AsyncObject {
    asyncId: number;
    type: string;
    triggerId: number;
    resource: any;
    state: AsyncState;
    startedCount: number;
    finishedCount: number;
    stack?: string;
}

const asyncObjects: Map<number, AsyncObject> = new Map();
const objectMapping: Map<object, AsyncObject> = new Map();

export function startAsyncTracing(stackTraces: boolean = false) {
    hook = onAsyncHook(stackTraces);
}

interface Trace {
    obj: object;
    trace: string;
}

export function trace(obj: object): Trace | void {
    let res = objectMapping.get(obj);
    if (!res) {
        // console.log(`trace: object not found: ${util.inspect(obj)}`);
        return;
    }
    let trace = `== Tracing leaked object ${res.asyncId} ==`;
    while (res) {
        const { stack, ...rest } = res;
        trace += `${inspect(rest)}\n${stack}`;
        res = asyncObjects.get(res.triggerId);
    }
    console.log(trace);
    return { obj, trace };
}

export function printAsyncStack() {
    console.log(`Async stack:`);
    let res = asyncObjects.get(asyncHooks.executionAsyncId());
    while (res) {
        const { stack, ...rest } = res;
        console.log(`%O\n${stack}`, rest);
        res = asyncObjects.get(res.triggerId);
    }
}

export function detectAsyncLeaks(): object[] {
    const leaks: Trace[] = [];
    (process as any)._getActiveHandles().forEach((h: object) => {
        if (h !== process.stdout && h !== process.stderr) {
            const leak = trace(h);
            leak && leaks.push(leak);
        }
    });
    (process as any)._getActiveRequests().forEach((h: object) => {
        const leak = trace(h);
        leak && leaks.push(leak);
    });
    return leaks;
}

export function printHooks() {
    for (const obj of asyncObjects) {
        console.log(`%O`, obj);
    }
}

export function stopAsyncTracing() {
    hook && hook();
}

export function onAsyncHook(stackTraces: boolean) {
    const hooks: asyncHooks.HookCallbacks = {
        init,
        before,
        after,
        destroy,
        promiseResolve
    };

    const asyncHook = asyncHooks.createHook(hooks);
    asyncHook.enable();

    return () => {
        asyncHook.disable();
    };

    function init(asyncId: number, type: string, triggerId: number, resource: object) {
        const obj: AsyncObject = {
            asyncId,
            type,
            triggerId,
            resource,
            state: "init",
            startedCount: 0,
            finishedCount: 0,
            stack: stackTraces
                ? new Error("stack:").stack!.replace(/Error:/, "")
                : undefined
        };
        asyncObjects.set(asyncId, obj);
        objectMapping.set(resource, obj);
    }
    function destroy(asyncId: number) {
        const obj = asyncObjects.get(asyncId);
        if (obj) {
            obj.state = "destroyed";
        } else {
            // console.log(`destroyed: No obj ${asyncId}`);
        }
    }
    function before(asyncId: number) {
        const obj = asyncObjects.get(asyncId);
        if (obj) {
            obj.state = "before";
            obj.startedCount++;
        } else {
            // console.log(`before: No obj ${asyncId}`);
        }
    }
    function after(asyncId: number) {
        const obj = asyncObjects.get(asyncId);
        if (obj) {
            obj.state = "after";
            obj.finishedCount++;
        } else {
            // console.log(`after: No obj ${asyncId}`);
        }
    }
    function promiseResolve(asyncId: number) {
        const obj = asyncObjects.get(asyncId);
        if (obj) {
            obj.state = "resolved";
        } else {
            // console.log(`resolved: No obj ${asyncId}`);
        }
    }
}

export function clearLeakDetector() {
    asyncObjects.clear();
    objectMapping.clear();
}

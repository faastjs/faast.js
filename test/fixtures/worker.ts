import { isMainThread, parentPort, Worker, workerData } from "worker_threads";

async function runIfWorker() {
    if (!isMainThread) {
        parentPort?.postMessage(`${workerData} done`);
    }
}

runIfWorker();

export async function runWorker(arg: string) {
    return new Promise<string>((resolve, reject) => {
        const worker = new Worker(__filename, { workerData: arg });
        worker.on("message", resolve);
        worker.on("error", reject);
        worker.on("exit", code => {
            if (code !== 0) {
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
        });
    });
}

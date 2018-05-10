import { cloudify, init, cleanup } from "./cloudify";
import { hello } from "./shared";

async function client() {
    await init();
    const remoteHello = cloudify(hello);
    const response = await remoteHello("Andy");
    console.log(`response: ${response}`);
    await cleanup();
}

client();

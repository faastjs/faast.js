import { cloudify, init } from "./cloudify";
import { hello } from "./shared";

async function client() {
    await init();
    const remoteHello = cloudify(hello);
    const response = await remoteHello("Andy");
    console.log(`response: ${response}`);
}

client();

import { coldStartTest } from "./shared";

coldStartTest("Google Https load test", "google", 200, {
    useQueue: false,
    memorySize: 1024
});

coldStartTest("Google queue load test", "google", 500, {
    memorySize: 1024
});

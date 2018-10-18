import { coldStartTest } from "./tests";

coldStartTest("Google Https load test", "google", 200, {
    mode: "https",
    memorySize: 1024
});

coldStartTest("Google queue load test", "google", 500, {
    mode: "queue",
    memorySize: 1024
});

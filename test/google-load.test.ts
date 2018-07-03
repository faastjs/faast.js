import { loadTest } from "./load-expected";

loadTest("Google Https load test", "google", 200, {
    useQueue: false,
    memorySize: 1024
});

loadTest("Google queue load test", "google", 500, {
    memorySize: 1024
});

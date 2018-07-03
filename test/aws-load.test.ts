import { loadTest } from "./load-expected";

loadTest("AWS Https test", "aws", 200, {
    memorySize: 1024,
    useQueue: false
});

loadTest("AWS queue test", "aws", 500, {
    memorySize: 1024
});

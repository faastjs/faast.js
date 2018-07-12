import { coldStartTest } from "./tests";

coldStartTest("AWS Https test", "aws", 500, {
    memorySize: 1024,
    useQueue: false
});

coldStartTest("AWS queue test", "aws", 500, {
    memorySize: 1024,
    useQueue: true
});

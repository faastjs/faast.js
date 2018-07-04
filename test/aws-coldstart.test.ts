import { coldStartTest } from "./shared";

coldStartTest("AWS Https test", "aws", 200, {
    memorySize: 1024,
    useQueue: false
});

coldStartTest("AWS queue test", "aws", 500, {
    memorySize: 1024
});

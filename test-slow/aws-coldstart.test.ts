import { coldStartTest } from "./tests";

coldStartTest("AWS Https test", "aws", 500, {
    memorySize: 1024,
    mode: "https"
});

coldStartTest("AWS queue test", "aws", 500, {
    memorySize: 1024,
    mode: "queue"
});

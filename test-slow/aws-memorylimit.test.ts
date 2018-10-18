import { checkMemoryLimit } from "./tests";

checkMemoryLimit("aws memory limit test with https", "aws", { mode: "https" });
checkMemoryLimit("aws memory limit test with queue", "aws", { mode: "queue" });

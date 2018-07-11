import { checkMemoryLimit } from "./tests";

checkMemoryLimit("aws memory limit test with https", "aws", { useQueue: false });
checkMemoryLimit("aws memory limit test with queue", "aws", { useQueue: true });

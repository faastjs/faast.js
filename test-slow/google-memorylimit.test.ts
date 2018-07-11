import { checkMemoryLimit } from "./tests";

checkMemoryLimit("google memory limit test with https", "google", { useQueue: false });

// checkMemoryLimit("google memory limit test with queue", "google", { useQueue: true });

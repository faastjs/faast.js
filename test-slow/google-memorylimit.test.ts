import { checkMemoryLimit } from "./tests";

checkMemoryLimit("google memory limit test with https", "google", { mode: "https" });

// checkMemoryLimit("google memory limit test with queue", "google", { useQueue: true });

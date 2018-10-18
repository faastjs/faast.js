import { checkTimeout } from "./tests";

checkTimeout("google function timeout test with https", "google", { mode: "https" });

// checkTimeout("google function timeout with queue", "google", { useQueue: true });

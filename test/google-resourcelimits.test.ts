import { checkResourceLimits } from "./tests";

checkResourceLimits("google function resource limits with https", "google", {
    useQueue: false
});
checkResourceLimits("google function resource limits with queue", "google", {
    useQueue: true
});

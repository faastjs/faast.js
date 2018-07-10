import { checkResourceLimits } from "./tests";

checkResourceLimits("aws function resource limits with https", "aws", {
    useQueue: false
});
checkResourceLimits("aws function resource limits with queue", "aws", { useQueue: true });

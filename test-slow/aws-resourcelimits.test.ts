import { checkTimeout } from "./tests";

checkTimeout("aws function resource limits with https", "aws", {
    useQueue: false
});
checkTimeout("aws function resource limits with queue", "aws", { useQueue: true });

import { checkTimeout } from "./tests";

checkTimeout("aws timeout test with https", "aws", { useQueue: false });
checkTimeout("aws timeout test with queue", "aws", { useQueue: true });

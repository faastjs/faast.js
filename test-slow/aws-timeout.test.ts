import { checkTimeout } from "./tests";

checkTimeout("aws timeout test with https", "aws", { mode: "https" });
checkTimeout("aws timeout test with queue", "aws", { mode: "queue" });

import { checkCodeBundle } from "./tests";
checkCodeBundle("Package AWS queue bundle", "aws", "aws-queue-bundle");

checkCodeBundle("Package AWS https bundle", "aws", "aws-queue-bundle", {
    useQueue: true
});

import { checkCodeBundle } from "./tests";

const kb = 1024;

checkCodeBundle("Package AWS queue bundle", "aws", "https-bundle", 50 * kb, {
    useQueue: false
});

checkCodeBundle("Package AWS https bundle", "aws", "queue-bundle", 50 * kb, {
    useQueue: true
});

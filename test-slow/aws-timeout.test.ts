import { testTimeout } from "../test/tests";

describe("AWS timeout limit", () => {
    describe("https mode", () => testTimeout("aws", { mode: "https" }));
    describe("queue mode", () => testTimeout("aws", { mode: "queue" }));
});

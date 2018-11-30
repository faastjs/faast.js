import { testFunctions } from "./tests";

describe("google-queue", () => testFunctions("google", { mode: "queue" }));

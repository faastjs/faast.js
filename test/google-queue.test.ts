import { testFunctions } from "./tests";

describe("google-queue", () => testFunctions("google", { mode: "queue" }, 360 * 1000));

import { testFunctions } from "./tests";

jest.setTimeout(10 * 1000);
describe("google-queue", () => testFunctions("google", { mode: "queue" }, 360 * 1000));

import { testFunctions } from "./tests";

jest.setTimeout(10 * 1000);
describe("google-https", () => testFunctions("google", { mode: "https" }, 360 * 1000));

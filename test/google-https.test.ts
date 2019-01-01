import { testFunctions } from "./tests";

describe("google-https", () => testFunctions("google", { mode: "https" }, 360 * 1000));

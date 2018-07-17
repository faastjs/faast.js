import { buildModulesOnLambda } from "../src/aws/aws-package";
import * as uuidv4 from "uuid/v4";

test(
    "Build node_modules on AWS lambda",
    async () => {
        const result = await buildModulesOnLambda("./test/package.json");
        console.log(result);
        expect(result).toMatch(/tslib/);
    },
    100 * 1000
);

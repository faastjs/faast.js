import { checkTimeout, checkMemoryLimit } from "./tests";

checkMemoryLimit("process memory limit test", "childprocess");
checkTimeout("process timeout test", "childprocess");

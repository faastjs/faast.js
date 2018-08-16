import { checkTimeout, checkMemoryLimit } from "./tests";

checkMemoryLimit("process memory limit test", "process");
checkTimeout("process timeout test", "process");

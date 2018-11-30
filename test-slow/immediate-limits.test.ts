import { checkTimeout, checkMemoryLimit } from "./tests";

checkMemoryLimit("process memory limit test", "immediate", { childProcess: true });
checkTimeout("process timeout test", "immediate", { childProcess: true });

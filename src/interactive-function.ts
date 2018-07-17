import * as sys from "child_process";

export function exec(cmd: string) {
    const result = sys.execSync(cmd).toString();
    console.log(result);
    return result;
}

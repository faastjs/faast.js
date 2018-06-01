import * as sys from "child_process";

export function exec(cmd: string) {
    const result = sys.execSync(cmd).toString();
    console.log(result);
    return result;
}

export function unzipInDir(dir: string, zipFile: string) {
    exec(
        `rm -rf ${dir} && mkdir -p ${dir} && cp ${zipFile} ${dir} && cd ${dir} && unzip -o ${zipFile}`
    );
}

export function test30(msg: string, f: () => Promise<void>) {
    return test(msg, f, 30 * 1000);
}

export function test60(msg: string, f: () => Promise<void>) {
    return test(msg, f, 60 * 1000);
}

export function test90(msg: string, f: () => Promise<void>) {
    return test(msg, f, 60 * 1000);
}

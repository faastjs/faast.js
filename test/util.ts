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

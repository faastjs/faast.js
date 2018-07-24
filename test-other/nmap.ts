// import * as libnmap from "libnmap";
import * as fs from "fs";
import Axios from "axios";
import * as sys from "child_process";

// const libnmap = require("libnmap");

function exec(cmd: string) {
    try {
        const result = sys.execSync(cmd).toString();
        console.log(result);
        return result + "\n";
    } catch (e) {
        return "MY ERROR: " + e;
    }
}

export async function nmap(_opts: any) {
    let rv = "";
    console.log(_opts);
    process.env.PATH = process.env.PATH + ":" + process.env.LAMBDA_TASK_ROOT + ":/tmp";
    process.env["LD_LIBRARY_PATH"] = process.env["LAMBDA_TASK_ROOT"] + "/tmp";

    const result = await Axios.request({
        method: "get",
        responseType: "arraybuffer",
        url:
            "https://github.com/andrew-d/static-binaries/raw/master/binaries/linux/x86_64/nmap"
    });

    fs.writeFileSync("/tmp/bin/nmap", result.data, {
        /*encoding: "binary",*/ mode: "777"
    });
    rv += exec("ls -al /bin");
    rv += exec("/tmp/nmap -p 80 www.google.com");

    rv += "\n";
    rv += `PATH: ${process.env.PATH}`;

    return rv;
    // await new Promise((resolve, reject) => {
    //     libnmap.scan(opts, (err: any, report: any) => {
    //         if (err) {
    //             throw new Error(err);
    //         }
    //         for (let item in report) {
    //             rv += JSON.stringify(report[item]);
    //         }
    //         resolve();
    //     });
    // });
    // return rv;
}

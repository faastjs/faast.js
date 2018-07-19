// import * as libnmap from "libnmap";
import * as fs from "fs";
import Axios from "axios";
import * as sys from "child_process";

const libnmap = require("libnmap");

function exec(cmd: string) {
    const result = sys.execSync(cmd).toString();
    console.log(result);
    return result + "\n";
}

export async function nmap(opts: any) {
    let rv = "";

    const result = await Axios.request({
        method: "get",
        responseType: "arraybuffer",
        url:
            "https://github.com/andrew-d/static-binaries/raw/master/binaries/linux/x86_64/nmap"
    });

    rv += JSON.stringify(result.headers);

    fs.writeFileSync("/tmp/nmap", result.data, { /*encoding: "binary",*/ mode: "777" });

    rv += exec("ls -al /tmp");
    rv += exec("file /tmp/nmap");
    rv += exec("cksum /tmp/nmap");
    rv += exec("/tmp/nmap");

    process.env.PATH += process.env.PATH + ":/tmp";

    rv += "\n";
    rv += `PATH: ${process.env.PATH}`;

    return rv;

    await new Promise((resolve, reject) => {
        libnmap.scan(opts, (err: any, report: any) => {
            if (err) {
                throw new Error(err);
            }

            for (let item in report) {
                rv += JSON.stringify(report[item]);
            }

            resolve();
        });
    });

    return rv;
}

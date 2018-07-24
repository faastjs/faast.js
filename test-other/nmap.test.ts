import * as cloudify from "../src/cloudify";
import * as nmap from "./nmap";

test(
    "nmap",
    async () => {
        const cloud = cloudify.create("aws");
        const lambda = await cloud.createFunction("./nmap", {
            useQueue: false,
            timeout: 90,
            packageJson: { dependencies: { libnmap: "*", axios: "*" } }
        });

        const remote = lambda.cloudifyAll(nmap);

        const opts = {
            range: [
                "scanme.nmap.org",
                "10.0.2.0/25",
                "192.168.10.80-120",
                "fe80::42:acff:fe11:fd4e/64"
            ]
        };

        const rv = await remote.nmap(opts);
        console.log(rv);
    },
    90 * 1000
);
//  libnmap

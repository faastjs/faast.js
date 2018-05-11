import * as webpack from "webpack";
import humanStringify from "human-stringify";

console.log(`Running webpack!`);

const config: webpack.Configuration = {
    entry: __filename,
    mode: "development",
    output: {
        path: `${__dirname}/..`,
        library: "trampoline",
        libraryTarget: "commonjs2"
    },
    externals: ["webpack", "human-stringify"],
    target: "node"
};

const compiler = webpack(config);

compiler.run(err => {
    err && console.error(err);
});

console.log(`${humanStringify({ field: "all done" })}.`);

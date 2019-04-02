/**
 * Copyright (c) 2017-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const React = require("react");

const CompLibrary = require("../../core/CompLibrary.js");

const Container = CompLibrary.Container;
const GridBlock = CompLibrary.GridBlock;

function Community(props) {
    const { config: siteConfig, language = "" } = props;
    const { baseUrl, docsUrl } = siteConfig;
    const docsPart = `${docsUrl ? `${docsUrl}/` : ""}`;
    const langPart = `${language ? `${language}/` : ""}`;
    const docUrl = doc => `${baseUrl}${docsPart}${langPart}${doc}`;

    const supportLinks = [
        {
            title: "Github",
            content:
                "View faast.js on [GitHub](https://github.com/GiantSquidBaby/faast.js)."
        },
        {
            title: "Slack",
            content:
                "Join our [community on Slack](https://join.slack.com/t/faastjs/shared_invite/enQtNTk0NTczMzI4NzQxLTA2MWU1NDA1ZjBkOTc3MTNkOGMzMDY0OWU1NGQ5MzM2NDY1YTJiZmNmODk4NzI0OWI1MzZhZDdiOTIzODNkOGY). <br>Already joined? [Sign in](https://faastjs.slack.com/)."
        },
        {
            title: "Stack Overflow",
            content:
                "Ask questions on [Stack Overflow](https://stackoverflow.com/questions/tagged/faast.js)."
        },
        {
            title: "Twitter",
            content: "Follow us on [twitter](https://twitter.com/faastjs)."
        }
    ];

    return (
        <div className="docMainWrapper wrapper">
            <Container className="mainContainer documentContainer postContainer">
                <div className="post">
                    <header className="postHeader">
                        <h1>Connect with the faast.js community</h1>
                    </header>
                    <GridBlock contents={supportLinks} layout="fourColumn" />
                </div>
            </Container>
        </div>
    );
}

module.exports = Community;

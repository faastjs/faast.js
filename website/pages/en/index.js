/**
 * Copyright (c) 2017-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const React = require("react");
const CompLibrary = require("../../core/CompLibrary.js");

const MarkdownBlock = CompLibrary.MarkdownBlock; /* Used to read markdown */

class HomeSplash extends React.Component {
    render() {
        const { siteConfig, language = "" } = this.props;
        const { baseUrl, docsUrl } = siteConfig;
        const docsPart = `${docsUrl ? `${docsUrl}/` : ""}`;
        const langPart = `${language ? `${language}/` : ""}`;
        const docUrl = doc => `${baseUrl}${docsPart}${langPart}${doc}`;

        const Button = props => (
            <div className="border border-solid border-blue-400 rounded p-2 m-2 w-32 inline-block hover:bg-blue-700 center">
                <a href={props.href} target={props.target} rel={props.rel}>
                    {props.children}
                </a>
            </div>
        );

        return (
            <div className="bg-blue-100 py-32 px-4 flex flex-col items-center">
                <img
                    className="max-w-2xl"
                    src={`${baseUrl}img/faastjs-blue.svg`}
                    alt="Project Logo"
                />
                <h2 className="text-gray-700 text-lg md:text-3xl py-8">
                    {siteConfig.tagline}
                </h2>
                <div>
                    <Button
                        href="https://github.com/faastjs/faast.js"
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        GitHub
                    </Button>
                    <Button href={docUrl("introduction")}>Docs</Button>
                    <Button
                        href="https://github.com/faastjs/examples"
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        Examples
                    </Button>
                </div>
            </div>
        );
    }
}

class Index extends React.Component {
    render() {
        const { config: siteConfig, language = "" } = this.props;
        const { baseUrl } = siteConfig;

        const Section = props => (
            <div id={props.id} className="flex items-center my-6 mx-48">
                <div className="flex-1 mr-8">
                    <h3 className="text-2xl font-semibold my-4">{props.title}</h3>
                    <p>{props.children}</p>
                </div>
                <a href={props.imageLink} className="flex-1">
                    <img src={props.image} className="p-12" />
                </a>
            </div>
        );

        const Example = () => (
            <Section
                id="example"
                title="Invoke serverless functions like regular functions."
                image={`${baseUrl}img/hello-world.png`}
                imageLink={`/docs/introduction#usage`}
            >
                Serverless function architectures are optimized for event-driven systems.
                Faast.js simplifies serverless batch applications by automating
                infrastructure, code packaging, invocation, and cleanup. Combine the power
                of scalable serverless functions with the ease-of-use and familiarity of
                ordinary async functions.
            </Section>
        );

        const ScaleUp = () => (
            <Section
                id="scaleup"
                title="Scale up. Scale down."
                image={`${baseUrl}img/invoke-1000.png`}
                imageLink="/docs/introduction#scaling-up"
            >
                Go from zero to a thousand cores in seconds. Scale back down to zero just
                as quickly. Faast.js delivers the brute force power of the cloud with the
                convenience and familiarity of asynchronous function calls.
            </Section>
        );

        const Dependencies = () => (
            <Section
                id="dependencies"
                title="Automate bundling and dependencies."
                image={`${baseUrl}img/packageJson.png`}
                imageLink="/docs/introduction#package-dependencies"
            >
                Deploy without zip files. Zero-configuration support for bundling
                dependencies with built-in webpack support. Use native dependencies, even
                on AWS Lambda. Faast.js eliminates the friction of using packages with
                serverless functions.
            </Section>
        );

        const Cost = () => (
            <Section
                id="cost"
                title="Estimate costs in real time."
                image={`${baseUrl}img/cost-estimate.png`}
                imageLink="/docs/cost-estimates"
            >
                Cost snapshots estimate the cost of your serverless function invocations
                in real time. For deeper analysis, use the Cost Analyzer to estimate the
                cost of workloads against multiple serverless configurations in parallel.
            </Section>
        );

        const zeroStyle = {
            backgroundImage: "url(../../img/trianglify.svg)"
        };

        const ZeroOps = () => (
            <div
                id="zeroops"
                className="flex items-center py-12 px-48 bg-fixed text-white"
                style={zeroStyle}
            >
                <img src={`${baseUrl}img/zero.svg`} className="mr-32 flex-1" />
                <div className="flex-1 mr-8">
                    <h3 className="text-2xl font-semibold my-4">
                        Develop faster with Zero-Ops.
                    </h3>
                    <p>
                        Serverless function calls are, by nature, ephemeral. Faast.js
                        takes this a step further by making serverless function
                        infrastructure ephemeral too. Welcome to infrastructure that's
                        deployed only as long as it's needed, and cleaned up when it's
                        not. <br />
                        <br />
                        No servers to manage.
                        <br />
                        No containers to build.
                        <br />
                        No infrastructure to monitor.
                        <br />
                        <br />
                        That's zero ops.
                    </p>
                </div>
            </div>
        );

        const Block = props => (
            <div className="px-24 py-8 center" id={props.id}>
                {props.children}
            </div>
        );

        const Feature = props => (
            <div className="flex-1 flex flex-col items-center px-12">
                <img className="w-20 resize-none" src={props.image} />
                <h3 className="text-lg my-4">{props.title}</h3>
                <p className="mt-4">{props.children}</p>
            </div>
        );

        const Features = props => [
            <Block id="features">
                <h1 className="text-4xl mb-12">The development features you'd expect.</h1>
                <div className="flex mx-12 items-center justify-center">
                    <Feature
                        image={`${baseUrl}img/lightning.svg`}
                        title="Get started faast"
                    >
                        No setup steps required.
                        <br />
                        Works from a bare cloud account.
                    </Feature>
                    <Feature image={`${baseUrl}img/cloud-plug.svg`} title="Multi-cloud">
                        AWS and Google Cloud support built-in.
                    </Feature>
                    <Feature image={`${baseUrl}img/logs.svg`} title="Logging">
                        Precise links to filtered cloud logs.
                    </Feature>
                </div>
            </Block>,
            <Block>
                <div className="flex mx-12 items-center justify-center">
                    <Feature image={`${baseUrl}img/ts.png`} title="Type Safe">
                        First class support for TypeScript. <br />
                        Retain type safety across cloud function calls.
                    </Feature>
                    <Feature image={`${baseUrl}img/bug.svg`} title="Debugging">
                        Switch to local mode to use standard debugging tools.
                    </Feature>
                    <Feature image={`${baseUrl}img/tested.svg`} title="Tested">
                        Comprehensive testsuite and examples.
                    </Feature>
                </div>
            </Block>
        ];

        const Showcase = () => {
            if ((siteConfig.users || []).length === 0) {
                return null;
            }

            const showcase = siteConfig.users
                .filter(user => user.pinned)
                .map(user => (
                    <a href={user.infoLink} key={user.infoLink}>
                        <img src={user.image} alt={user.caption} title={user.caption} />
                    </a>
                ));

            const pageUrl = page => baseUrl + (language ? `${language}/` : "") + page;

            return (
                <div className="productShowcaseSection paddingBottom">
                    <h2>Who is Using This?</h2>
                    <p>This project is used by all these people</p>
                    <div className="logos">{showcase}</div>
                    <div className="more-users">
                        <a className="button" href={pageUrl("users.html")}>
                            More {siteConfig.title} Users
                        </a>
                    </div>
                </div>
            );
        };

        return (
            <div>
                <HomeSplash siteConfig={siteConfig} language={language} />
                <div className="mainContainer">
                    <Example />
                    <ScaleUp />
                    <Dependencies />
                    <Cost />
                    <ZeroOps />
                    <Features />
                </div>
            </div>
        );
    }
}

module.exports = Index;

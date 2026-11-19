/**
 * Copyright (c) 2017-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const React = require("react");
const CompLibrary = require("../../core/CompLibrary.js");

const MarkdownBlock = CompLibrary.MarkdownBlock; /* Used to read markdown */
const Container = CompLibrary.Container;
const GridBlock = CompLibrary.GridBlock;

class HomeSplash extends React.Component {
    render() {
        const { siteConfig, language = "" } = this.props;
        const { baseUrl, docsUrl } = siteConfig;
        const docsPart = `${docsUrl ? `${docsUrl}/` : ""}`;
        const langPart = `${language ? `${language}/` : ""}`;
        const docUrl = doc => `${baseUrl}${docsPart}${langPart}${doc}`;

        const SplashContainer = props => (
            <div className="homeContainer">
                <div className="homeSplashFade">
                    <div className="wrapper heroWrapper">{props.children}</div>
                </div>
            </div>
        );

        const Logo = props => (
            <div className="faastLogo">
                <img src={props.img_src} alt="Project Logo" />
            </div>
        );

        const ProjectTitle = () => (
            <h2 className="projectTitle">
                {siteConfig.tagline}
            </h2>
        );

        const PromoSection = props => (
            <div className="section promoSection">
                <div className="promoRow">
                    <div className="pluginRowBlock">{props.children}</div>
                </div>
            </div>
        );

        const Button = props => (
            <div className="pluginWrapper buttonWrapper">
                <a
                    className="button"
                    href={props.href}
                    target={props.target}
                    rel={props.rel}
                >
                    {props.children}
                </a>
            </div>
        );

        return (
            <SplashContainer>
                <div className="inner">
                    <ProjectTitle siteConfig={siteConfig} />
                    <PromoSection>
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
                    </PromoSection>
                </div>
            </SplashContainer>
        );
    }
}

class Index extends React.Component {
    render() {
        const { config: siteConfig, language = "" } = this.props;
        const { baseUrl } = siteConfig;

        const Block = props => (
            <div className="feature">
                <Container
                    padding={props.padding}
                    id={props.id}
                    background={props.background}
                >
                    <GridBlock
                        align="center"
                        contents={props.children}
                        layout={props.layout}
                    />
                </Container>
            </div>
        );

        const Why = () => (
            <div class="wrapper">
                <div class="question">
                    <h2>Faast.js makes serverless functions:</h2>
                    <img
                        class="prefix"
                        src={`${baseUrl}img/icons8-source_code.svg`}
                        height="40px"
                    />
                    <span class="emphasize">Easy to program</span> using regular async
                    functions.
                    <p />
                    <img
                        class="prefix"
                        src={`${baseUrl}img/icons8-broadcasting.svg`}
                        height="40px"
                    />
                    <span class="emphasize">Scalable</span> to a thousand cores and
                    beyond.
                    <p />
                    <img
                        class="prefix"
                        src={`${baseUrl}img/icons8-do_not_drop.svg`}
                        height="40px"
                    />
                    <span class="emphasize">Productive</span> with support for npm
                    packages, type safety, and local development.
                    <p />
                    <img
                        class="prefix"
                        src={`${baseUrl}img/icons8-cheap_2.svg`}
                        height="40px"
                    />
                    <span class="emphasize">Cost-optimized</span> with real-time estimates
                    and workload optimization. <p />
                    <img
                        class="prefix"
                        src={`${baseUrl}img/icons8-virus_free.svg`}
                        height="40px"
                    />
                    <span class="emphasize">Zero-Ops</span> with infrastructure
                    ephemerality as core design principle.
                    <p />
                    Today, faast.js is ready for rapid iteration on embarrassingly
                    parallel problems. <br />
                    Tomorrow, faast.js will grow more capable as serverless function
                    platforms mature. <br />
                    Read on to learn more.
                </div>
            </div>
        );

        const Example = () => (
            <Block id="example">
                {[
                    {
                        title: "Invoke serverless functions like regular functions.",
                        content: `Serverless function architectures are optimized for event-driven systems. Faast.js simplifies serverless  batch applications by automating infrastructure, code packaging, invocation, and cleanup. Combine the power of scalable serverless functions with the ease-of-use and familiarity of ordinary async functions.`,
                        image: `${baseUrl}img/hello-world.png`,
                        imageLink: `/docs/introduction#usage`,
                        imageAlign: "right"
                    }
                ]}
            </Block>
        );

        const ScaleUp = () => (
            <Block id="scaleup">
                {[
                    {
                        title: "Scale up. Scale down.",
                        content: `Go from zero to a thousand cores in seconds. Scale back down to zero just as quickly. Faast.js delivers the brute force power of the cloud with the convenience and familiarity of asynchronous function calls.`,
                        image: `${baseUrl}img/invoke-1000.png`,
                        imageLink: `/docs/introduction#scaling-up`,
                        imageAlign: "right"
                    }
                ]}
            </Block>
        );

        const Dependencies = () => (
            <Block id="dependencies">
                {[
                    {
                        title: "Automate bundling and dependencies.",
                        content:
                            "Deploy without zip files. Zero-configuration support for bundling dependencies with built-in webpack support. Use native dependencies, even on AWS Lambda. Faast.js eliminates the friction of using packages with serverless functions. ",
                        image: `${baseUrl}img/packageJson.png`,
                        imageLink: `/docs/introduction#package-dependencies`,
                        imageAlign: "right"
                    }
                ]}
            </Block>
        );

        const Cost = () => (
            <Block id="cost">
                {[
                    {
                        title: "Estimate costs in real time.",
                        content:
                            "Cost snapshots estimate the cost of your serverless function invocations in real time. For deeper analysis, use the Cost Analyzer to estimate the cost of workloads against multiple serverless configurations in parallel.",
                        image: `${baseUrl}img/cost-estimate.png`,
                        imageLink: `/docs/cost-estimates`,
                        imageAlign: "right"
                    }
                ]}
            </Block>
        );

        const ZeroOps = () => (
            <Block id="zeroops" padding={["top", "bottom"]}>
                {[
                    {
                        image: `${baseUrl}img/zero.svg`,
                        imageAlign: "left",
                        title: "Develop faster with Zero-Ops.",
                        content:
                            "Serverless function calls are, by nature, ephemeral. Faast.js takes this a step further by making serverless function *infrastructure* ephemeral too. Welcome to infrastructure that's deployed only as long as it's needed, and cleaned up when it's not. <br><br>No servers to manage.<br>No containers to build.<br>No infrastructure to monitor.<br><br>That's zero ops."
                    }
                ]}
            </Block>
        );

        const Features = props => [
            <Container id="features">
                <h1>The development features you'd expect.</h1>
                <GridBlock
                    layout="threeColumn"
                    align="center"
                    contents={[
                        {
                            image: `${baseUrl}img/lightning.svg`,
                            imageAlign: "top",
                            title: "Get started faast",
                            content:
                                "No setup steps required.<br>Works from a bare cloud account."
                        },
                        {
                            image: `${baseUrl}img/cloud-plug.svg`,
                            imageAlign: "top",
                            title: "Multi-cloud",
                            content: "AWS support built-in."
                        },
                        {
                            image: `${baseUrl}img/logs.svg`,
                            imageAlign: "top",
                            title: "Logging",
                            content: "Precise links to filtered cloud logs."
                        }
                    ]}
                />
            </Container>,
            <Container padding={["top", "bottom"]} background={props.background}>
                <GridBlock
                    layout="threeColumn"
                    align="center"
                    contents={[
                        {
                            image: `${baseUrl}img/ts.png`,
                            imageAlign: "top",
                            title: "Type Safe",
                            content:
                                "First class support for TypeScript. <br>Retain type safety across cloud function calls."
                        },
                        {
                            image: `${baseUrl}img/bug.svg`,
                            imageAlign: "top",
                            title: "Debugging",
                            content:
                                "Switch to local mode to use standard debugging tools."
                        },
                        {
                            image: `${baseUrl}img/tested.svg`,
                            imageAlign: "top",
                            title: "Tested",
                            content: "Comprehensive testsuite and examples."
                        }
                    ]}
                />
            </Container>
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

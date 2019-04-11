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
                {siteConfig.title}
                <small>{siteConfig.tagline}</small>
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
                <Logo img_src={`${baseUrl}img/faastjs.svg`} />
                <div className="inner">
                    <ProjectTitle siteConfig={siteConfig} />
                    <PromoSection>
                        <Button href="#example">About</Button>
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
                    padding={props.padding || ["top"]}
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

        // *Lambdas*. They're supposed to be functions. But creating and using lambda functions involves a lot of incidental complexity. Suddenly you're knee deep in command line tools, configuration files, web consoles,  and execution roles. Didn't we get into this to *just run some code?*

        // <p>Faast.js functions summon the resources they need automatically, do their job, and then go away when they're done. Faast.js doesn't leave behind any operational infrastructure to worry about.

        const Example = () => (
            <Block id="example">
                {[
                    {
                        title: "Invoke serverless functions like regular functions.",
                        content: `Serverless functions are powerful and scalable, but their architecture is geared towards event-driven systems. Faast.js simplifies serverless deployment and invocation for batch applications by abstracting function deployment and invocation.`,
                        image: `${baseUrl}img/basic.png`,
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
                        title: "Automatic Dependency Bundling.",
                        content:
                            "Serverless functions are inconvenient to package and deploy. Iterating quickly is difficult when you have to manually install dependencies and create zip files. Faast.js uses webpack to automatically bundle dependencies, so most packages can be used with no extra steps. And native dependencies are also supported through a built-in build system that creates Lambda Layers for you.",
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
                            "Cost snapshots estimate the cost of your serverless function invocations in real time. For deeper analysis, use the Cost Analyzer to estimate the cost of workloads against multiple serverless configurations in parallel. Finally get an answer ",
                        image: `${baseUrl}img/cost-estimate.png`,
                        imageLink: `/docs/cost-estimates`,
                        imageAlign: "right"
                    }
                ]}
            </Block>
        );

        const ZeroOps = () => (
            <Block id="zeroops" padding={["top"]}>
                {[
                    {
                        image: `${baseUrl}img/zero.svg`,
                        imageAlign: "left",
                        title: "Zero Ops",
                        content:
                            "Faast.js creates serverless function infrastructure on demand. Infrastructure only exists as long as it's needed, and a garbage collector ensures nothing gets left behind. Faast.js infrastructure is *ephemeral*. <br><br>No servers to manage.<br>No containers to manage.<br>No infrastructure to manage.<br><br>That's Zero Ops."
                    }
                ]}
            </Block>
        );

        const Features = props => [
            <Container padding={["top"]} id="features">
                <h1>The development features you'd expect.</h1>
                <GridBlock
                    layout="threeColumn"
                    align="center"
                    contents={[
                        {
                            image: `${baseUrl}img/lightning.svg`,
                            imageAlign: "top",
                            title: "Get started fast",
                            content:
                                "No setup steps required.<br>Works from a bare cloud account."
                        },
                        {
                            image: `${baseUrl}img/cloud-plug.svg`,
                            imageAlign: "top",
                            title: "Multi-cloud",
                            content: "AWS and Google Cloud support built-in."
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

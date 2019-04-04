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
                <a className="button" href={props.href} target={props.target}>
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
                        <Button href="#example">Example</Button>
                        <Button href={docUrl("introduction")}>Docs</Button>
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
            <Container
                padding={["bottom", "top"]}
                id={props.id}
                background={props.background}
            >
                <GridBlock
                    align="center"
                    contents={props.children}
                    layout={props.layout}
                />
            </Container>
        );

        const FeatureCallout = () => (
            <div className="productShowcaseSection">
                <image id="zero" src={`${baseUrl}img/zero.svg`} width="25%" />
                <h2>Zero Ops</h2>
                <h3>No infrastructure to manage.</h3>
            </div>
        );

        const Example = () => (
            <Block id="example">
                {[
                    {
                        content: `Create serverless functions without any cruft. Leave no trace of infrastructure behind. Your code gains superpowers with faast.js`,
                        align: "left",
                        image: `${baseUrl}img/example-1.png`,
                        imageLink: `/docs/introduction#scaling-up`,
                        imageAlign: "left",
                        title: "More dev, less ops."
                    }
                ]}
            </Block>
        );

        const Features = props => [
            <Container padding={["top"]} id={props.id}>
                <GridBlock
                    layout="threeColumn"
                    align="center"
                    contents={[
                        {
                            image: `${baseUrl}img/scale.svg`,
                            imageAlign: "top",
                            title: "Autoscale",
                            content:
                                "Leverage the scale of AWS and Google Cloud to scale to a thousand cores and beyond."
                        },
                        {
                            image: `${baseUrl}img/cloud-plug.svg`,
                            imageAlign: "top",
                            title: "Choose your cloud",
                            content:
                                "Power faast.js with AWS or Google Cloud, or on local compute."
                        },
                        {
                            image: `${baseUrl}img/cost.svg`,
                            imageAlign: "top",
                            title: "Instant Cost Estimates",
                            content:
                                "Analyze and optimize cloud costs for batch workloads."
                        }
                    ]}
                />
            </Container>,
            <Container
                padding={["top", "bottom"]}
                id={props.id}
                background={props.background}
            >
                <GridBlock
                    layout="twoColumn"
                    align="center"
                    contents={[
                        {
                            image: `${baseUrl}img/pack.svg`,
                            imageAlign: "top",
                            title: "Transparent bundling",
                            content:
                                "There's no separate deploy step to forget."
                        },
                        {
                            image: `${baseUrl}img/cleanup.svg`,
                            imageAlign: "top",
                            title: "Leave the cleanup to us",
                            content: "Cleans up after itself."
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
                        <img
                            src={user.image}
                            alt={user.caption}
                            title={user.caption}
                        />
                    </a>
                ));

            const pageUrl = page =>
                baseUrl + (language ? `${language}/` : "") + page;

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
                    <Features />
                    <FeatureCallout />
                    <Example />
                </div>
            </div>
        );
    }
}

module.exports = Index;

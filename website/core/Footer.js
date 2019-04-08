/**
 * Copyright (c) 2017-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const React = require("react");

class Footer extends React.Component {
    docUrl(doc, language) {
        const baseUrl = this.props.config.baseUrl;
        const docsUrl = this.props.config.docsUrl;
        const docsPart = `${docsUrl ? `${docsUrl}/` : ""}`;
        //const langPart = `${language ? `${language}/` : ""}`;
        const langPart = "";
        return `${baseUrl}${docsPart}${langPart}${doc}`;
    }

    pageUrl(doc, language) {
        const baseUrl = this.props.config.baseUrl;
        return baseUrl + (language ? `${language}/` : "") + doc;
    }

    render() {
        return (
            <footer className="nav-footer" id="footer">
                <section className="sitemap">
                    <a href={this.props.config.baseUrl} className="nav-home">
                        {this.props.config.footerIcon && (
                            <img
                                src={
                                    this.props.config.baseUrl +
                                    this.props.config.footerIcon
                                }
                                alt={this.props.config.title}
                                width="66"
                                height="58"
                            />
                        )}
                    </a>
                    <div>
                        <h5>Docs</h5>
                        <a href={this.docUrl("introduction", this.props.language)}>
                            Introduction
                        </a>
                        <a href={this.docUrl("api/faastjs", this.props.language)}>
                            API Reference
                        </a>
                        <a href={this.docUrl("contributing", this.props.language)}>
                            Contributing
                        </a>
                        <a
                            href="https://github.com/faastjs/examples"
                            target="_blank"
                            rel="noreferrer noopener"
                        >
                            Examples
                        </a>
                    </div>
                    <div>
                        <h5>Community</h5>
                        <a
                            href="https://faastjs.slack.com/"
                            target="_blank"
                            rel="noreferrer noopener"
                        >
                            Slack
                        </a>
                        <a
                            href="https://twitter.com/faastjs"
                            target="_blank"
                            rel="noreferrer noopener"
                        >
                            Twitter
                        </a>
                        <a
                            href="http://stackoverflow.com/questions/tagged/faast.js"
                            target="_blank"
                            rel="noreferrer noopener"
                        >
                            Stack Overflow
                        </a>
                        <a
                            className="github-button"
                            href={this.props.config.repoUrl}
                            data-show-count="true"
                            aria-label="Star faast.js on GitHub"
                        >
                            faast.js
                        </a>
                    </div>
                    <div>
                        <h5>More</h5>
                        <a href={`${this.props.config.baseUrl}blog`}>Blog</a>

                        <a href={this.pageUrl("users.html", this.props.language)}>
                            User Showcase
                        </a>
                    </div>
                </section>

                <section className="copyright">{this.props.config.copyright}</section>
            </footer>
        );
    }
}

module.exports = Footer;

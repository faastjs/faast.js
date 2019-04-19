/**
 * Copyright (c) 2017-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// See https://docusaurus.io/docs/site-config for all the possible
// site configuration options.

// List of projects/orgs using your project for the users page.
const users = [
    {
        caption: "FOSSA",
        // You will need to prepend the image path with your baseUrl
        // if it is not '/', like: '/test-site/img/faastjs.svg'.
        image: "https://fossa.com/images/logo.svg",
        infoLink: "https://www.fossa.com",
        pinned: true
    }
];

const repoUrl = "https://github.com/faastjs/faast.js";

const siteConfig = {
    title: "faast.js", // Title for your website.
    tagline: "Serverless batch computing made simple",
    url: repoUrl, // Your website URL
    baseUrl: "/", // Base URL for your project */
    // For github.io type URLs, you would set the url and baseUrl like:
    //   url: 'https://facebook.github.io',
    //   baseUrl: '/test-site/',

    // Used for publishing and more
    projectName: "faast.js",
    organizationName: "faastjs",
    // For top-level user or org sites, the organization is still the same.
    // e.g., for the https://JoelMarcey.github.io site, it would be set like...
    //   organizationName: 'JoelMarcey'

    // For no header links in the top nav bar -> headerLinks: [],
    headerLinks: [
        { doc: "introduction", label: "Docs" },
        { doc: "api/faastjs", label: "API" },
        { page: "community", label: "Community" },
        { href: repoUrl, label: "GitHub" },
        { blog: true, label: "Blog" }
    ],

    // If you have users set above, you add it here:
    users,

    /* path to images for header/footer */
    headerIcon: "img/faastjs-icon.svg",
    footerIcon: "img/faastjs-icon-color.svg",
    favicon: "img/favicon.png",

    /* Colors for website */
    colors: {
        primaryColor: "#2196F3",
        secondaryColor: "#42b0f4"
    },

    /* Custom fonts for website */
    /*
  fonts: {
    myFont: [
      "Times New Roman",
      "Serif"
    ],
    myOtherFont: [
      "-apple-system",
      "system-ui"
    ]
  },
  */

    // This copyright info is used in /core/Footer.js and blog RSS/Atom feeds.
    copyright: `Copyright © ${new Date().getFullYear()} Andy Chou`,

    highlight: {
        // Highlight.js theme to use for syntax highlighting in code blocks.
        theme: "vs2015"
    },

    // Add custom scripts here that would be placed in <script> tags.
    scripts: [
        "https://buttons.github.io/buttons.js",
        "https://cdnjs.cloudflare.com/ajax/libs/clipboard.js/2.0.0/clipboard.min.js",
        "/js/code-block-buttons.js"
    ],

    stylesheets: [
        "/css/code-block-buttons.css",
        {
            href: "https://fonts.googleapis.com/css?family=Source+Code+Pro",
            rel: "stylesheet"
        },
        {
            href: "https://use.typekit.net/wzm6mbg.css",
            rel: "stylesheet"
        }
    ],

    // On page navigation for the current documentation page.
    onPageNav: "separate",
    // No .html extensions for paths.
    cleanUrl: true,

    // Open Graph and Twitter card images.
    ogImage: "img/faastjs.png",
    twitterImage: "img/faastjs.png",

    // Show documentation's last contributor's name.
    // enableUpdateBy: true,

    // Show documentation's last update time.
    // enableUpdateTime: true,

    // You may provide arbitrary config keys to be used as needed by your
    // template. For example, if you need your repo's URL...
    repoUrl
};

module.exports = siteConfig;

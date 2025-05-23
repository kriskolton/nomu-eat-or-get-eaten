const fs = require("fs");
const path = require("path");
const { minify } = require("html-minifier-terser");

const inputFile = path.join(__dirname, "public", "index.html");
const outputFile = path.join(__dirname, "public", "index.html");

(async () => {
  const html = fs.readFileSync(inputFile, "utf8");

  const minifiedHtml = await minify(html, {
    removeComments: true,
    collapseWhitespace: true,
    removeRedundantAttributes: true,
    useShortDoctype: true,
    removeEmptyAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    minifyJS: true, // minifies inline JS
    minifyCSS: true, // minifies inline CSS
    sortAttributes: true,
    sortClassName: true,
  });

  fs.writeFileSync(outputFile, minifiedHtml, "utf8");
  console.log("HTML and inline JS/CSS minified:", outputFile);
})();

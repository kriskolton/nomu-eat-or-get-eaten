const fs = require("fs");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");

const inputFile = path.join(__dirname, "src", "index.html");

const outputFile = path.join(__dirname, "public", "index.html");

// Read the HTML file
let html = fs.readFileSync(inputFile, "utf8");

// Regex: Only matches <script> blocks WITHOUT a src attribute
html = html.replace(
  /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi,
  (match, jsCode) => {
    if (!jsCode.trim()) return match;
    // Obfuscate JS
    const obfuscated = JavaScriptObfuscator.obfuscate(jsCode, {
      compact: true,
      controlFlowFlattening: true,
      deadCodeInjection: true,
      stringArray: true,
      stringArrayEncoding: ["base64"],
      identifierNamesGenerator: "hexadecimal", // Aggressively renames vars
      renameGlobals: true, // Renames top-level variables
      sourceMap: false,
      sourceType: "script", // Use "module" if you use import/export
    }).getObfuscatedCode();
    return match.replace(jsCode, obfuscated);
  }
);

// Write output
fs.writeFileSync(outputFile, html);
console.log("Obfuscated HTML saved to:", outputFile);

// Static CommonJS bridge so Netlify's esbuild can see the CRS engine tree.
// Do not load the engine through createRequire from an .mjs file — that path
// is invisible to the function bundler (see src/underwrite/engine.mjs).
"use strict";

module.exports = require("../../../vendor/underwriteiq-full/api/lite/crs/engine.js");

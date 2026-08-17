import { test } from "node:test";
import assert from "node:assert/strict";
import { renderWordmarkSvg, wordmarkDataUrl } from "./wordmark.mjs";

test("wordmark SVG carries the name and escapes markup", () => {
  const svg = renderWordmarkSvg({
    name: 'Acme <script>alert(1)</script>',
    displayFace: "Fraunces",
    ink: "#112233",
    paper: "#fefefe"
  });
  assert.match(svg, /Acme/);
  assert.match(svg, /#112233/);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
});

test("wordmarkDataUrl is a data URL the brand upload already accepts", () => {
  const url = wordmarkDataUrl({ name: "Acme" });
  assert.match(url, /^data:image\/svg\+xml;utf8,/);
  assert.match(decodeURIComponent(url), /Acme/);
});

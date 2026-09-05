// The design names Inter and JetBrains Mono thirty-odd times and the Python
// declared no @font-face at all, so anywhere but the author's Mac the whole
// document silently fell back to Arial. These tests are the guard on that.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { FACES, FONT_DIR, fontFaceCss, resetFontCache } from "./fonts.mjs";
import { renderDeliverableHtml } from "./index.mjs";
import { emptyBlackReportClient } from "../underwrite/black-report-client.mjs";

const CLIENT = emptyBlackReportClient();

describe("deliverables/fonts", () => {
  test("all nine faces ship in the repo", () => {
    assert.equal(FACES.length, 9);
    for (const [, , file] of FACES) {
      const path = join(FONT_DIR, file);
      assert.ok(existsSync(path), `${file} is missing from assets/fonts`);
      assert.ok(statSync(path).size > 100_000, `${file} is too small to be a real face`);
    }
  });

  test("both families are declared", () => {
    const families = new Set(FACES.map(([f]) => f));
    assert.deepEqual([...families].sort(), ["Inter", "JetBrains Mono"]);
  });

  test("href mode registers every face and downloads nothing into the page", () => {
    const css = fontFaceCss({ href: "/assets/fonts/" });
    assert.equal((css.match(/@font-face/g) || []).length, 9);
    assert.ok(css.includes('src: url("/assets/fonts/Inter-Regular.ttf") format("truetype")'));
    assert.ok(!css.includes("base64"));
  });

  test("embedded mode carries the four faces the stylesheet can select", () => {
    resetFontCache();
    const css = fontFaceCss();
    assert.equal((css.match(/@font-face/g) || []).length, 4);
    for (const want of ['font-family: "Inter"; font-style: normal; font-weight: 400',
      'font-family: "Inter"; font-style: normal; font-weight: 700',
      'font-family: "JetBrains Mono"; font-style: normal; font-weight: 400',
      'font-family: "JetBrains Mono"; font-style: normal; font-weight: 700']) {
      assert.ok(css.includes(want), `missing ${want}`);
    }
    assert.equal((css.match(/data:font\/ttf;base64,/g) || []).length, 4);
  });

  test("a rendered page really carries the faces, not just the family name", () => {
    const html = renderDeliverableHtml({ client: CLIENT, doc: "funding_snapshot" }).html;
    assert.ok(html.includes("@font-face"), "the page declares its faces");
    assert.ok(html.includes('font-family: "Inter", "Arial", sans-serif'),
      "the fallback stack is still there for a face that fails to load");
  });

  test("a face that is not on disk is left out, and nothing throws", () => {
    resetFontCache();
    const css = fontFaceCss({ dir: join(FONT_DIR, "no-such-directory") });
    assert.equal(css, "", "no faces, and no exception");
    resetFontCache();
  });

  test("an absolute URL base works as well as a path", () => {
    const css = fontFaceCss({ href: "https://cdn.example.com/f/" });
    assert.ok(css.includes('url("https://cdn.example.com/f/JetBrainsMono-Bold.ttf")'));
  });
});

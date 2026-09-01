/* The four status colours must never be repainted by a brand.
 *
 * WHAT THIS PROTECTS. --alert, --warn, --ok and --info are read in hundreds of
 * places across public/, and every one of them is a STATE SIGNAL in a regulated
 * consumer-finance product: blocked, behind, healthy. paintBrand() in
 * public/app/shell.js used to overwrite all four from stops 0, 1, 3 and 4 of
 * whatever six-stop ramp the brand carried.
 *
 * WHY THAT IS NOT SURVIVABLE NOW. Nothing constrains a ramp to semantically sane
 * stops, and a real brand guideline is very often a single-hue gradient — six
 * shades of one colour. Feed that in and "stop, this is blocked" paints the same
 * as "all good". It had already happened on a test tenant whose screens went
 * entirely blue. It stayed theoretical only because one org, with a sensibly
 * chosen ramp, was the only thing that reached the CRM.
 *
 * As of 2026-08-31 a white-label PARTNER's own brand paints their CRM screens
 * (api/org-brand.mjs resolves the brand from the principal), so a hostile or
 * merely monochrome ramp is now an ordinary Tuesday — and it would land on the
 * partner's own staff, who have nobody to walk around it.
 *
 * THE TEST RUNS THE REAL FUNCTION. paintBrand is lifted out of shell.js by
 * source and evaluated against a fake documentElement that records every custom
 * property written, so this asserts BEHAVIOUR and not the presence of a comment.
 * A shape check follows it, because a second writer added elsewhere in the file
 * would not be caught by calling this one function.
 *
 * Owner-set 2026-08-31. docs/BRAND-THEMING-SPEC.md, "Status colors".
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHELL = path.resolve(HERE, "../../public/app/shell.js");
const SRC = fs.readFileSync(SHELL, "utf8");

/* The four that must stay put, and the ones a brand is allowed to move. */
const SEMANTIC = ["--alert", "--warn", "--ok", "--info"];
const BRANDED = ["--ink", "--paper", "--spectrum", "--accent"];

/* A deliberately awful brand: one hue, six stops, exactly the shape a real
   single-hue brand guideline produces. Under the old code stops 0/1/3/4 became
   alert/warn/ok/info — four near-identical blues. */
const SINGLE_HUE = {
  ink: "#0B1F3A",
  paper: "#F4F7FB",
  ramp: ["#0A2A55", "#12467F", "#1A62A9", "#2F80C9", "#5FA3DC", "#9BC6EC"],
  display_face: "Rubik",
  mono_face: "Roboto Mono",
  wordmark_url: "https://partner.example.com/mark.svg",
  entity_name: "Single Hue Capital"
};

/* Pull the three functions paintBrand depends on plus paintBrand itself out of
   shell.js. Named declarations, so a brace-balanced slice from
   `function <name>(` is exact. */
function extract(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `shell.js no longer declares ${name}() — this test is stale`);
  let depth = 0, seen = false;
  for (let i = start; i < SRC.length; i++) {
    const c = SRC[i];
    if (c === "{") { depth++; seen = true; }
    else if (c === "}") { depth--; if (seen && depth === 0) return SRC.slice(start, i + 1); }
  }
  assert.fail(`could not find the end of ${name}() in shell.js`);
  return "";
}

function runPaintBrand(brand) {
  const written = {};
  const root = { style: { setProperty(k, v) { written[k] = v; } } };
  const sandbox = {
    BRAND: brand,
    document: {
      documentElement: root,
      head: { appendChild() {} },
      getElementById: () => null,
      createElement: () => ({ setAttribute() {} })
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    [extract("rampToSpectrum"), extract("safeWordmark"), extract("injectFonts"),
      extract("paintBrand")].join("\n") + "\n;paintBrand(BRAND);",
    sandbox
  );
  return written;
}

test("a single-hue partner ramp does not repaint the four status colours", () => {
  const written = runPaintBrand(SINGLE_HUE);
  for (const token of SEMANTIC) {
    assert.equal(written[token], undefined,
      `paintBrand wrote ${token} — a single-hue brand ramp can now make ` +
      `"blocked", "behind" and "healthy" render as the same colour`);
  }
});

test("the brand still paints ground, ink, spectrum and accent", () => {
  const written = runPaintBrand(SINGLE_HUE);
  for (const token of BRANDED) {
    assert.notEqual(written[token], undefined,
      `paintBrand stopped writing ${token} — the brand no longer reaches the page`);
  }
  assert.equal(written["--ink"], SINGLE_HUE.ink);
  assert.equal(written["--paper"], SINGLE_HUE.paper);
  assert.equal(written["--accent"], SINGLE_HUE.ramp[5]);
  assert.match(written["--sans"], /^'Rubik'/);
  assert.match(written["--mono"], /^'Roboto Mono'/);
  assert.equal(written["--logo"], 'url("https://partner.example.com/mark.svg")');
});

test("an empty ramp still leaves every status colour alone", () => {
  const written = runPaintBrand({ ...SINGLE_HUE, ramp: [] });
  for (const token of SEMANTIC) assert.equal(written[token], undefined);
  assert.equal(written["--spectrum"], undefined, "an empty ramp must not build a spectrum");
});

test("nothing anywhere in shell.js writes a status colour", () => {
  /* paintBrand is not the only thing that could. A second writer added later
     would pass the behavioural tests above and still flatten every badge. */
  for (const token of SEMANTIC) {
    const re = new RegExp(`setProperty\\(\\s*["']${token}["']`, "g");
    const hits = SRC.match(re) || [];
    assert.equal(hits.length, 0,
      `shell.js writes ${token} — the four status colours are semantic and ` +
      `fixed at their fundhub-brand.css values (docs/BRAND-THEMING-SPEC.md)`);
  }
});

test("fundhub-brand.css still defines all four, since nothing overwrites them now", () => {
  const css = fs.readFileSync(path.resolve(HERE, "../../public/app/fundhub-brand.css"), "utf8");
  for (const token of SEMANTIC) {
    assert.match(css, new RegExp(`${token}\\s*:`),
      `${token} has no value in fundhub-brand.css and nothing sets it at runtime ` +
      `any more — every badge using it would render unstyled`);
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const presentJs = fs.readFileSync(path.join(APP, "present.js"), "utf8");
const presentHtml = fs.readFileSync(path.join(APP, "present.html"), "utf8");
const closerHtml = fs.readFileSync(path.join(APP, "closer-call.html"), "utf8");
const closerJs = fs.readFileSync(path.join(APP, "closer-call.js"), "utf8");

test("present.html is a fullscreen deck, not a sidebar screen", () => {
  assert.ok(presentHtml.includes('src="present.js"'));
  assert.ok(!presentHtml.includes('src="shell.js"'), "loading shell.js would force a sidebar row");
  assert.ok(presentHtml.includes("fundhub-brand.css"));
});

test("screen prices come from the offers catalog, not hardcoded dollars", () => {
  for (const key of ["SOFT_PULL", "FUNDING_DFY", "REPAIR_DFY", "REPAIR_TRIAL", "UWIQ_DELIVERABLES", "FUNDING_MASTERY"]) {
    assert.ok(presentJs.includes('price("' + key + '")'), "missing price(" + key + ")");
  }
  assert.ok(!/TRIAL_PRICE\s*=\s*200/.test(presentJs));
  assert.ok(!/PAYLOADS\s*=/.test(presentJs));
  assert.ok(!/Marcus Webb/.test(presentJs));
});

test("letters action is absent on the qualified funding route", () => {
  assert.ok(presentJs.includes("function lettersOk"));
  assert.ok(presentJs.includes("o.letters"));
  assert.ok(presentJs.includes("letters_blocked") || presentJs.includes("generate_letters"));
});

test("closer call cockpit has a Present control that deep-links the contact", () => {
  assert.ok(closerHtml.includes('id="fh-present"'));
  assert.ok(closerHtml.includes("Present"));
  assert.ok(closerJs.includes("present.html?contact="));
});

test("present cockpit can send soft pull and variable-price e-book", () => {
  assert.ok(presentJs.includes("send_soft_pull"));
  assert.ok(presentJs.includes("send_ebook"));
  assert.ok(presentJs.includes("Send soft pull"));
  assert.ok(presentJs.includes("ebookDollars"));
  assert.ok(presentJs.includes("amount_cents"));
});

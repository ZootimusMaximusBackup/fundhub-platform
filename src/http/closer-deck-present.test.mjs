import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const presentJs = fs.readFileSync(path.join(APP, "present.js"), "utf8");
const presentHtml = fs.readFileSync(path.join(APP, "present.html"), "utf8");
const closerHtml = fs.readFileSync(path.join(APP, "closer-dashboard.html"), "utf8");
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

test("Closer Dashboard has a Present control that deep-links the contact", () => {
  assert.ok(closerHtml.includes('id="fh-present"'));
  assert.ok(closerHtml.includes("Present"));
  assert.ok(closerJs.includes("present.html?contact="));
});

test("send contract lives on Closer Dashboard and Present, not the wording page", () => {
  assert.ok(closerHtml.includes('id="fh-send-contract"'));
  assert.ok(closerHtml.includes("contract-send.js"));
  assert.ok(closerJs.includes("FHContractSend"));
  assert.ok(presentHtml.includes("contract-send.js"));
  assert.ok(presentJs.includes("Send contract"));
  assert.ok(presentJs.includes("FHContractSend"));
  assert.ok(presentJs.includes("sendToClient"));
});

test("present cockpit can send soft pull and variable-price e-book", () => {
  assert.ok(presentJs.includes("send_soft_pull"));
  assert.ok(presentJs.includes("send_ebook"));
  assert.ok(presentJs.includes("Send soft pull"));
  assert.ok(presentJs.includes("ebookDollars"));
  assert.ok(presentJs.includes("amount_cents"));
});

test("disposition UI has an explicit repair-referral control", () => {
  assert.ok(presentJs.includes('id="fh-repair-referral"'));
  assert.ok(presentJs.includes("repair_referral"));
  assert.ok(closerJs.includes('id="fh-repair-referral"'));
  assert.ok(closerJs.includes("repair_referral"));
});

test("non-funding pay links require an explicit downsell or upsell choice", () => {
  assert.ok(presentJs.includes('id="fh-sale-motion"'));
  assert.ok(presentJs.includes('value="downsell"'));
  assert.ok(presentJs.includes('value="upsell"'));
  assert.ok(presentJs.includes("sale_motion: action === \"send_pay_link\" ? selectedSaleMotion() : null"));
  assert.doesNotMatch(
    presentJs,
    /selectedOfferKey\(\)\s*===\s*"FUNDING_DFY"\s*\?\s*null\s*:\s*"downsell"/,
    "motion must not be derived from the selected product"
  );
});

test("S-23 pay click always POSTs send_pay_link", () => {
  assert.match(
    presentJs,
    /if \(a === "pay"\) \{\s*fire\("send_pay_link"\); return; \}/
  );
  assert.doesNotMatch(
    presentJs,
    /Choose downsell or upsell first/
  );
});

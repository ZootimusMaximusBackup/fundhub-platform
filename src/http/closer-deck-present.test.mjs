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

test("Closer Dashboard Send fills company, days, and email blanks", () => {
  assert.ok(closerJs.includes("fillBlankInputs"));
  assert.ok(closerJs.includes("defaultBlankValues"));
  assert.ok(closerJs.includes("template_key"));
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

test("non-primary pay links still require an explicit downsell or upsell choice", () => {
  assert.ok(presentJs.includes('id="fh-sale-motion"'));
  assert.ok(presentJs.includes('value="downsell"'));
  assert.ok(presentJs.includes('value="upsell"'));
  assert.ok(presentJs.includes("isPrimaryPayOffer"));
  assert.match(
    presentJs,
    /key === "FUNDING_DFY" \|\| key === "REPAIR_DFY" \|\| key === "REPAIR_TRIAL" \|\| key === "FUNDING_MASTERY"/
  );
  assert.ok(presentJs.includes("sale_motion: action === \"send_pay_link\" ? selectedSaleMotion() : null"));
  assert.doesNotMatch(
    presentJs,
    /selectedOfferKey\(\)\s*===\s*"FUNDING_DFY"\s*\?\s*null\s*:\s*"downsell"/,
    "motion must not be derived from the selected product"
  );
});

test("S-23 has Invoice this client and mints a payment link", () => {
  assert.ok(presentJs.includes("Invoice this client"));
  assert.ok(presentJs.includes("invoiceThisClient"));
  assert.ok(presentJs.includes("/api/payment-links"));
  assert.ok(presentJs.includes('purpose: "invoice"'));
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

/* Hole 16 — a file with more than one company was priced off a business age
   nobody ever asked for. Present now asks for the month and year. */
test("Present asks for the incorporation month and year", () => {
  assert.ok(presentJs.includes("function incorporationAsk"), "no incorporation ask in the cockpit");
  assert.ok(presentJs.includes("When was each business incorporated?"));
  assert.ok(/type="month"/.test(presentJs), "the ask has no month/year input");
  assert.ok(presentJs.includes("Save month / year"));
  assert.ok(presentJs.includes("stamp-inc:"), "no save button action");
});

test("the ask sits on discovery, inside slides 1 to 12", () => {
  const discovery = presentJs.indexOf('if (ph === "02 Discovery")');
  assert.ok(discovery > -1);
  const softPull = presentJs.indexOf('if (ph === "03 Soft pull"');
  assert.ok(presentJs.indexOf("incorporationAsk()", discovery) > discovery);
  assert.ok(presentJs.indexOf("incorporationAsk()", discovery) < softPull,
    "the ask must render during discovery, not after the pull");
});

test("Present saves the date through the same staff action as the Control Panel", () => {
  assert.ok(presentJs.includes("stamp_incorporated"));
  assert.ok(presentJs.includes('window.FHData.write("/api/soft-pull-approve"'));
  assert.ok(presentJs.includes("business_name"));
  assert.ok(presentJs.includes("incorporated_date"));
});

test("Present never guesses a date and never hides a missing one", () => {
  assert.ok(presentJs.includes("function businessesNeedingDate"));
  assert.ok(presentJs.includes("Do not take a guess."));
  assert.ok(presentJs.includes("When was it incorporated?"),
    "the client slide must show the missing date as a question, not a blank");
  assert.ok(/\^\\d\{4\}-\\d\{2\}\$/.test(presentJs), "no month/year format check before saving");
});

test("the client slide lists every company on the file, not just one", () => {
  const s03 = presentJs.indexOf('if (c === "S-03")');
  assert.ok(s03 > -1);
  const s04 = presentJs.indexOf('if (c === "S-04")');
  assert.ok(presentJs.indexOf("businesses().map", s03) > s03);
  assert.ok(presentJs.indexOf("businesses().map", s03) < s04);
});

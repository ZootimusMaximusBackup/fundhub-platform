/* THE AMOUNT THE BANK ALREADY TOLD US.
 *
 * A bank's decision email states the approved figure in plain text. The
 * classifier in src/adapters/mailgun.mjs has always found that figure — it used
 * it to nudge its confidence — and then discarded it, so a funding advisor
 * retyped by hand a number the system already had. When they forgot, the
 * approval carried no dollar amount and the round could not be billed
 * (docs/CLOSEOUT-FEE-BASIS.md).
 *
 * These tests pin the four rules the capture has to obey:
 *
 *   1. A real approval email yields a suggestion.
 *   2. An email with several figures does NOT silently pick one — every figure
 *      is carried and the true count is reported.
 *   3. An email with no figure yields no suggestion, and never a zero.
 *   4. A denial still classifies DENIED and offers nothing at all.
 *
 * Plus: the classifier's own decisions are untouched by any of it.
 */
import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  findDollarAmounts,
  bodyPreviewOf,
  classifyBankEmail,
  handleMailgunWebhook
} from "./mailgun.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";

const SIGNING_KEY = "mailgun-test-signing-key";

function makeBody(overrides = {}) {
  const ts = String(Date.now());
  const tok = crypto.randomBytes(22).toString("hex");
  const signature = crypto.createHmac("sha256", SIGNING_KEY).update(ts + tok).digest("hex");
  return {
    signature: { timestamp: ts, token: tok, signature },
    subject: overrides.subject || "Test email",
    sender: overrides.from || "lender@bank.com",
    "body-plain": overrides.body === undefined ? "Hello there" : overrides.body,
    "Message-Id": overrides.messageId || `<${Date.now()}-${Math.random()}@mg.fundhub.ai>`
  };
}

function fakeDb(store = []) {
  let n = 0;
  return {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        const row = { id: `evt-${++n}` };
        store.push({ ...row, name: params[1], payload: params[5] });
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

async function emitOnce(bodyOverrides) {
  _resetOrgCache();
  clearHandlers();
  const seen = [];
  on("mail.response", (e) => seen.push(e.payload));
  const res = await handleMailgunWebhook({
    db: fakeDb(),
    body: makeBody(bodyOverrides),
    signingKey: SIGNING_KEY
  });
  assert.equal(res.ok, true, "the webhook was accepted");
  assert.equal(seen.length, 1, "exactly one mail.response");
  return seen[0];
}

// ---------------------------------------------------------------------------
// findDollarAmounts — the pure read
// ---------------------------------------------------------------------------

test("one stated amount comes back as one suggestion, as fixed dollars", () => {
  const out = findDollarAmounts(
    "Your application decision",
    "Congratulations! You have been approved for a credit limit of $5,000."
  );
  assert.deepEqual(out.candidates, ["5000.00"]);
  assert.equal(out.found, 1);
});

test("cents are kept exactly — no float multiply", () => {
  // 450.10 * 100 is 45009.999999999996 in JavaScript. A $450.10 approval must
  // never come back as $450.09.
  const out = findDollarAmounts("", "Approved for $450.10 today.");
  assert.deepEqual(out.candidates, ["450.10"]);
});

test("a single decimal place is read as tenths, not as cents", () => {
  const out = findDollarAmounts("", "Approved: $5,000.5");
  assert.deepEqual(out.candidates, ["5000.50"]);
});

test("SEVERAL FIGURES: every one is carried and NONE is nominated", () => {
  const out = findDollarAmounts(
    "Your new card",
    "Your credit limit is $7,500. The annual fee is $95. Your minimum payment " +
    "is $35 and your cash advance limit is $1,500."
  );
  assert.deepEqual(out.candidates, ["7500.00", "95.00", "35.00", "1500.00"]);
  assert.equal(out.found, 4);
  // Nothing in the shape marks one as the answer. If a `chosen`/`amount`/
  // `approved` key ever appears here, somebody has started guessing.
  assert.deepEqual(Object.keys(out).sort(), ["candidates", "found"]);
});

test("the same figure twice is one suggestion, not two", () => {
  const out = findDollarAmounts("Approved for $5,000", "You are approved for $5,000.");
  assert.deepEqual(out.candidates, ["5000.00"]);
  assert.equal(out.found, 1);
});

test("the subject is read before the body", () => {
  const out = findDollarAmounts("Approved: $9,000", "Your limit of $250 applies to cash.");
  assert.deepEqual(out.candidates, ["9000.00", "250.00"]);
});

test("NO FIGURE MEANS NO SUGGESTION — and never a zero", () => {
  const out = findDollarAmounts("You're approved", "Congratulations, your application was approved.");
  assert.deepEqual(out.candidates, []);
  assert.equal(out.found, 0);
});

test("a literal $0 is dropped rather than offered", () => {
  const out = findDollarAmounts("", "Your annual fee is $0.00 and your balance is $0.");
  assert.deepEqual(out.candidates, []);
  assert.equal(out.found, 0);
});

test("an absurd figure is refused rather than carried", () => {
  const out = findDollarAmounts("", "Reference $999,999,999,999 on file.");
  assert.deepEqual(out.candidates, []);
});

test("more distinct figures than we carry: the TRUE count is still reported", () => {
  const out = findDollarAmounts(
    "",
    "$1 $2 $3 $4 $5 $6 $7 $8 — every one of these is a different figure."
  );
  assert.equal(out.candidates.length, 6, "capped at six");
  assert.equal(out.found, 8, "but the screen is told there were eight");
});

test("nothing at all in, nothing out — no throw on null or undefined", () => {
  assert.deepEqual(findDollarAmounts(null, undefined), { candidates: [], found: 0 });
});

// ---------------------------------------------------------------------------
// bodyPreviewOf — the capped preview that replaces the duplicated subject
// ---------------------------------------------------------------------------

test("preview: hard-wrapped mail is flattened to one readable line", () => {
  assert.equal(bodyPreviewOf("You have been\napproved for\n$5,000."),
    "You have been approved for $5,000.");
});

test("preview: no text at all is NULL, not an empty string", () => {
  // The screen falls through to classification and date on a NULL. An "" is
  // populated as far as that fallback is concerned, which is the exact bug the
  // duplicated subject line caused.
  assert.equal(bodyPreviewOf(""), null);
  assert.equal(bodyPreviewOf("   \n  "), null);
  assert.equal(bodyPreviewOf(null), null);
  assert.equal(bodyPreviewOf(undefined), null);
});

test("preview: a long email is capped, and the cut is marked, not silent", () => {
  const preview = bodyPreviewOf("x".repeat(10000));
  assert.ok(preview.length < 600, "well under the 6 MB a request may carry");
  assert.ok(preview.indexOf("[truncated]") !== -1, "a shortened value says so");
  assert.ok(preview.startsWith("x".repeat(500)), "the first 500 characters are kept");
});

test("preview: the whole email is NOT stored", () => {
  const account = "Account number 4111111111111111 appears far down the message.";
  const preview = bodyPreviewOf("You are approved for $5,000. " + "filler ".repeat(200) + account);
  assert.equal(preview.indexOf("4111111111111111"), -1,
    "the back half of a forwarded statement never reaches the row");
});

// ---------------------------------------------------------------------------
// The whole path — what actually lands on mail.response
// ---------------------------------------------------------------------------

test("A REAL APPROVAL EMAIL YIELDS A SUGGESTION on the event", async () => {
  const payload = await emitOnce({
    subject: "Your Chase application",
    body: "Congratulations! You've been approved for a credit limit of $5,000."
  });
  assert.equal(payload.classification, "APPROVED");
  assert.deepEqual(payload.amountCandidates, ["5000.00"]);
  assert.equal(payload.amountCandidatesFound, 1);
  assert.ok(payload.bodyPreview.indexOf("$5,000") !== -1, "the preview holds the sentence");
});

test("SEVERAL FIGURES on the event: all carried, none picked", async () => {
  const payload = await emitOnce({
    subject: "Your new account",
    body: "You are approved. Credit limit $7,500. Annual fee $95. Minimum payment $35."
  });
  assert.equal(payload.classification, "APPROVED");
  assert.deepEqual(payload.amountCandidates, ["7500.00", "95.00", "35.00"]);
  assert.equal(payload.amountCandidatesFound, 3);
  assert.equal(payload.approved_amount, undefined, "nothing on the event names an approved amount");
  assert.equal(payload.approvedAmount, undefined);
  assert.equal(payload.amount, undefined);
});

test("NO FIGURE: the event carries an empty list and no zero", async () => {
  const payload = await emitOnce({
    subject: "You're approved",
    body: "Congratulations, your application was approved. Your card is on its way."
  });
  assert.equal(payload.classification, "APPROVED");
  assert.deepEqual(payload.amountCandidates, []);
  assert.equal(payload.amountCandidatesFound, 0);
});

test("A DENIAL STILL CLASSIFIES DENIED, AND OFFERS NOTHING", async () => {
  const payload = await emitOnce({
    subject: "Your application decision",
    body: "Unfortunately, you were not approved for the requested credit limit of $10,000."
  });
  assert.equal(payload.classification, "DENIED", "the negation fix is untouched");
  assert.equal("amountCandidates" in payload, false,
    "a denial is never scanned — the figure in it is the limit being refused");
  assert.equal("amountCandidatesFound" in payload, false);
});

test("a counteroffer offers its figures — that lower number is the one that gets billed", async () => {
  const payload = await emitOnce({
    subject: "Your application decision",
    body: "We approved you for a reduced amount of $2,000 rather than the $10,000 requested."
  });
  assert.equal(payload.classification, "COUNTEROFFER");
  assert.deepEqual(payload.amountCandidates, ["2000.00", "10000.00"]);
  assert.equal(payload.amountCandidatesFound, 2);
});

test("the event no longer repeats the subject as its own preview", async () => {
  const payload = await emitOnce({
    subject: "Your application decision",
    body: "Congratulations, you are approved for $4,000."
  });
  assert.notEqual(payload.bodyPreview, payload.subject);
});

test("an email with a subject and no body at all carries a NULL preview", async () => {
  const payload = await emitOnce({ subject: "Approved", body: "" });
  assert.equal(payload.bodyPreview, null);
});

// ---------------------------------------------------------------------------
// The classifier is not allowed to have moved
// ---------------------------------------------------------------------------

test("the classifier's decisions are exactly what they were", () => {
  assert.equal(
    classifyBankEmail("Your application decision", "Unfortunately, you were not approved for the requested credit limit."),
    "DENIED"
  );
  assert.equal(
    classifyBankEmail("You've been approved!", "Congratulations, your credit limit is $5,000."),
    "APPROVED"
  );
  assert.equal(
    classifyBankEmail("Your application", "We approved you for a reduced amount of $2,000."),
    "COUNTEROFFER"
  );
  assert.equal(
    classifyBankEmail("Refund", "Your fee has been refunded."),
    "NOISE"
  );
});

/* GATE A'S EVIDENCE, AT THE READ LAYER — the two lines that decide it.
 *
 * COMPLIANCE REVIEW REQUIRED. Everything in this file guards Chris's first
 * non-negotiable rule: a client with NO recorded written permission is NEVER
 * told to pull their credit. Both halves of that rule are decided in
 * read-signals.mjs, in two single lines, and a mutation pass found neither line
 * had a test. Breaking either one hands "Pull CRS" to a whole page of clients
 * with degraded:false — the screen would not even mark the answer as doubtful.
 *
 * WHAT IS PINNED HERE, AND WHY IT IS NOT IN read-signals.pg.test.mjs.
 * That file skips whenever DATABASE_URL is unset, which is the default, so it
 * cannot be the only test of a compliance gate. Nothing below needs Postgres:
 * consentSignalFromRow() is pure, and gatherListSignals() takes its database
 * handle as an argument, so a fake one that refuses a read proves the
 * failed-read path exactly. Same reasoning as
 * src/http/dashboard-next-action.test.mjs's header.
 *
 * Neither test asserts the shape alone. Each also runs the gathered signals
 * through deriveNextAction(), because the shape is not the point — what a
 * closer is told to do is the point.
 */

import { test, describe } from "node:test";
import assert from "node:assert";
import { CONSENT_REASONS } from "../consent/index.mjs";
import {
  consentSignalFromRow,
  gatherListSignals,
  signalsForListRow
} from "./read-signals.mjs";
import { deriveNextAction } from "./next-action.mjs";

const ORG_ID = "00000000-0000-0000-0000-0000000000aa";
const CLIENT_ID = "00000000-0000-0000-0000-0000000000bb";

/* A client row exactly as api/dashboard/clients.mjs's own SQL returns it:
   paid for the credit report, nothing pulled, on a funding tier. The ONLY
   thing standing between this client and "Pull CRS" is the consent verdict. */
const listRow = (over = {}) => ({
  id: CLIENT_ID,
  custom_fields_raw: { crs_paid: true },
  tags_raw: [],
  outcome_tier: "FULL_FUNDING",
  ...over
});

/* A database handle that answers every read with no rows, except the ones
   whose SQL matches `refuse` — those throw, which is how a table that has not
   been migrated, or a permission refusal, actually behaves. */
function fakeDb({ refuse = null } = {}) {
  const seen = [];
  return {
    seen,
    async query(sql) {
      const text = String(sql);
      seen.push(text);
      if (refuse && refuse.test(text)) {
        throw new Error('relation "client_consents" does not exist');
      }
      return { rows: [] };
    }
  };
}

describe("GATE A: no consent row on file is a NO, and it must stay a NO", () => {

  /* THE LINE: `if (!row) return { valid: false, reason: NONE, consent: null }`
     in consentSignalFromRow(). It is the whole verdict for every client who
     has never signed anything, which on this book is most of them. Flip its
     `valid` to true and those clients are handed "Pull CRS" with degraded
     false — an instruction the pull endpoint would then refuse. */
  test("no consent row at all is not a valid consent", () => {
    for (const row of [undefined, null]) {
      const s = consentSignalFromRow(row);
      assert.strictEqual(s.valid, false,
        "a client with no consent row on file was reported as having valid permission");
      assert.strictEqual(s.reason, CONSENT_REASONS.NONE,
        "the reason must say nothing is on file, not guess at a different one");
      assert.strictEqual(s.consent, null);
    }
  });

  test("a row that IS valid still reads as valid — the line above is not a blanket no", () => {
    const s = consentSignalFromRow({ is_valid: true, revoked_at: null, granted_at: new Date() });
    assert.strictEqual(s.valid, true);
    assert.strictEqual(s.reason, CONSENT_REASONS.OK);
  });

  /* The consequence, end to end. This is the assertion that matters: a client
     who has signed nothing must be told to GET permission, never to pull. */
  test("a client with zero consent rows is told to Get Consent, never to Pull CRS", async () => {
    const db = fakeDb();
    const batched = await gatherListSignals(db, { orgId: ORG_ID, clientIds: [CLIENT_ID] });
    const derived = deriveNextAction(signalsForListRow(listRow(), batched.get(CLIENT_ID)));

    assert.notEqual(derived.next_action && derived.next_action.key, "pull_crs",
      "a client with no written permission on file was told to pull their credit");
    assert.equal(derived.next_action && derived.next_action.key, "get_consent",
      "the truthful next step is to get permission. Got: " + JSON.stringify(derived.next_action));
    assert.equal(derived.degraded, false,
      "every read succeeded, so this is a confident answer, not a partial one");
  });
});

describe("GATE A: a consent read that FAILED is not a consent that said no", () => {

  /* THE LINE: `if (consentRows !== null) { signals.consent = ... }` in
     gatherListSignals(). safeRows() answers null when the read threw, and the
     verdict is then left OFF the signals object entirely so next-action.mjs
     degrades. Give it any default — even one that looks safe — and "we could
     not look" quietly becomes an answer. Defaulting it to valid hands out
     "Pull CRS"; defaulting it to invalid tells a client who HAS signed to sign
     again. Neither is a thing anyone measured. */
  test("a failed consent read leaves the verdict ABSENT, never defaulted", async () => {
    const db = fakeDb({ refuse: /FROM client_consents/ });
    const batched = await gatherListSignals(db, { orgId: ORG_ID, clientIds: [CLIENT_ID] });
    const signals = batched.get(CLIENT_ID);

    assert.ok(signals, "the client fell out of the signal map entirely");
    assert.ok(!("consent" in signals),
      "a consent read that failed still published a verdict: " + JSON.stringify(signals.consent));
    assert.strictEqual(signals.consent, undefined);
  });

  test("the other signals survive a failed consent read — one read, one signal", async () => {
    const db = fakeDb({ refuse: /FROM client_consents/ });
    const batched = await gatherListSignals(db, { orgId: ORG_ID, clientIds: [CLIENT_ID] });
    const signals = batched.get(CLIENT_ID);

    assert.strictEqual(signals.real_crs_result_count, 0,
      "one failed read cost a signal that had nothing to do with it");
    assert.deepEqual(signals.inquiry_cases, []);
    assert.deepEqual(signals.tasks, []);
  });

  /* The consequence, end to end. An unreadable verdict must produce NO
     instruction and must say so, so the screen falls back to today's display
     instead of painting a chip nobody can stand behind. */
  test("a client whose consent could not be read gets no instruction, and is marked degraded", async () => {
    const db = fakeDb({ refuse: /FROM client_consents/ });
    const batched = await gatherListSignals(db, { orgId: ORG_ID, clientIds: [CLIENT_ID] });
    const derived = deriveNextAction(signalsForListRow(listRow(), batched.get(CLIENT_ID)));

    assert.equal(derived.next_action, null,
      "a client whose written permission could not be read was still handed an instruction: " +
      JSON.stringify(derived.next_action));
    assert.equal(derived.degraded, true,
      "the screen was not told the answer is partial, so it would paint the chip as fact");
  });

  test("the same client reads normally when the consent read works", async () => {
    // The control. Without this, the two tests above would also pass if
    // gatherListSignals() had simply stopped returning anything at all.
    const db = fakeDb();
    const batched = await gatherListSignals(db, { orgId: ORG_ID, clientIds: [CLIENT_ID] });
    const signals = batched.get(CLIENT_ID);
    assert.ok("consent" in signals, "a successful consent read published no verdict");
    assert.strictEqual(signals.consent.valid, false);
    assert.strictEqual(signals.consent.reason, CONSENT_REASONS.NONE);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   A FAILED BLOCKER READ IS NOT "NOTHING IS BLOCKING THIS FILE".

   The blocker list is assembled from three reads — tasks, funding_rounds and
   v_invoice_balance. When any one of them refused, the inputs were dropped, the
   list came out EMPTY, and nothing was marked degraded. An empty blocker list
   is the whole condition for "Ready to Fund", so an unreadable table quietly
   became a chip saying the file is clear to fund, and no screen could tell.

   Forced here by refusing the tasks read — what a missing table, a permission
   refusal or a statement timeout actually looks like from this layer.
   ──────────────────────────────────────────────────────────────────────────── */

/* A client who really would be Ready to Fund: written permission live, the
   identity packet complete, nothing else on the file. The only thing left to
   decide the answer is whether the blocker list was read. */
const READY_CONSENT_ROW = {
  client_id: CLIENT_ID, is_valid: true, revoked_at: null, granted_at: new Date()
};
const READY_DOC_ROWS = [
  { client_id: CLIENT_ID, kind: "client_upload", subtype: "id_document" },
  { client_id: CLIENT_ID, kind: "client_upload", subtype: "proof_of_address" },
  { client_id: CLIENT_ID, kind: "client_upload", subtype: "soft_pull_consent" }
];

function readyDb({ refuse = null } = {}) {
  return {
    async query(sql) {
      const text = String(sql);
      if (refuse && refuse.test(text)) throw new Error('relation "tasks" does not exist');
      if (/FROM client_consents/.test(text)) return { rows: [READY_CONSENT_ROW] };
      if (/FROM documents/.test(text)) return { rows: READY_DOC_ROWS };
      return { rows: [] };
    }
  };
}

// Nothing paid for, so "Pull CRS" is a plain NO and the walk runs to the end.
const readyRow = () => listRow({ custom_fields_raw: {} });

describe("a blocker list that could not be read is not an empty one", () => {

  test("a refused blocker read publishes NO inputs, and says the list is unknown", async () => {
    const db = readyDb({ refuse: /FROM tasks/ });
    const batched = await gatherListSignals(db, { orgId: ORG_ID, clientIds: [CLIENT_ID] });
    const signals = batched.get(CLIENT_ID);

    assert.strictEqual(signals.blockers_unknown, true,
      "the read failed and the signals did not say so, so an empty blocker list " +
      "reads as a file with nothing wrong with it");
    assert.ok(!("blocker_inputs" in signals),
      "a partial blocker list was published: " + JSON.stringify(signals.blocker_inputs));
    assert.strictEqual(signals.tasks, undefined,
      "a failed tasks read still published a task list");
  });

  test("a successful blocker read never sets the flag", async () => {
    const db = readyDb();
    const signals = (await gatherListSignals(db, { orgId: ORG_ID, clientIds: [CLIENT_ID] }))
      .get(CLIENT_ID);
    assert.strictEqual(signals.blockers_unknown, undefined,
      "a read that worked was reported as a read that failed");
    assert.ok(signals.blocker_inputs, "a successful blocker read published no inputs");
  });

  /* The consequence, end to end, through the real read layer. */
  test("the control: every read works, and this client IS Ready to Fund", async () => {
    const db = readyDb();
    const batched = await gatherListSignals(db, { orgId: ORG_ID, clientIds: [CLIENT_ID] });
    const derived = deriveNextAction(signalsForListRow(readyRow(), batched.get(CLIENT_ID)));

    assert.equal(derived.next_action && derived.next_action.key, "ready_to_fund",
      "the fixture stopped reaching Ready to Fund, so the test below proves nothing. " +
      "Got: " + JSON.stringify(derived.next_action));
    assert.equal(derived.degraded, false);
  });

  test("with the blocker read refused, the same client is told nothing and marked degraded", async () => {
    const db = readyDb({ refuse: /FROM tasks/ });
    const batched = await gatherListSignals(db, { orgId: ORG_ID, clientIds: [CLIENT_ID] });
    const derived = deriveNextAction(signalsForListRow(readyRow(), batched.get(CLIENT_ID)));

    assert.equal(derived.next_action, null,
      "a file whose blockers could not be read was still called clear to fund: " +
      JSON.stringify(derived.next_action));
    assert.equal(derived.degraded, true,
      "a failed read came back as a confident answer with zero blockers");
    assert.deepEqual(derived.active_blockers, [],
      "nothing may be invented for a list that was never read");
  });
});

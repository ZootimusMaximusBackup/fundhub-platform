import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  NEXT_ACTIONS,
  FUNDING_CHIP_KEYS,
  deriveNextAction,
  guardConsentBeforePull,
  guardFundingProduct,
  sanitizeBlockerLabels
} from "./next-action.mjs";

const NOW = new Date("2026-08-19T12:00:00Z");

/* A client on whom EVERY chip evaluates to NO. Each test turns exactly one
   thing on, so a chip firing is always attributable to the thing turned on.
   Note what has to be present for nothing to be UNKNOWN: tags, custom_fields,
   consent and credit evidence. That is the contract, made visible. */
const base = (over = {}) => ({
  outcome_tier: "FULL_FUNDING",
  tags: [],
  custom_fields: {},
  consent: { valid: true, reason: "valid", consent: {} },
  crs_results: [],
  inquiry_cases: [],
  doc_packet: null,
  dispute_responses: [],
  dispute_cases: [],
  tasks: [],
  funding_rounds: [],
  card: null,
  open_blockers: [],
  now: NOW,
  ...over
});

const keyOf = (signals) => deriveNextAction(signals).next_action?.key ?? null;

describe("the order is Chris's, exactly", () => {

  test("ten chips, in Chris's words, in Chris's order", () => {
    assert.deepEqual(NEXT_ACTIONS.map((a) => [a.key, a.label]), [
      ["clear_fraud_alert", "Clear Fraud Alert"],
      ["get_consent", "Get Consent"],
      ["pull_crs", "Pull CRS"],
      ["remove_inquiries", "Remove Inquiries"],
      ["collect_documents", "Collect Documents"],
      ["review_disputes", "Review Disputes"],
      ["review_funding_file", "Review Funding File"],
      ["prepare_next_round", "Prepare Next Round"],
      ["apply_for_funding", "Apply for Funding"],
      ["ready_to_fund", "Ready to Fund"]
    ]);
  });

  test("Lock Fee and File Prep are not chips", () => {
    const keys = NEXT_ACTIONS.map((a) => a.key);
    assert.ok(!keys.includes("lock_fee"));
    assert.ok(!keys.includes("file_prep"));
  });

  test("Ready to Fund is ranked last", () => {
    assert.equal(NEXT_ACTIONS[NEXT_ACTIONS.length - 1].key, "ready_to_fund");
  });

  /* GATE A, ORDERING HALF: Get Consent must sit ABOVE Pull CRS, or
     first-match-wins cannot keep a no-consent client away from the pull. */
  test("GATE A ordering: Get Consent ranks above Pull CRS", () => {
    const i = NEXT_ACTIONS.findIndex((a) => a.key === "get_consent");
    const j = NEXT_ACTIONS.findIndex((a) => a.key === "pull_crs");
    assert.ok(i >= 0 && j >= 0);
    assert.ok(i < j, "Get Consent must rank above Pull CRS");
  });

  /* GATE B, ORDERING HALF: the isFunding flags and the hard guard's own list
     must name the same four chips. If they drift, one of the two halves of
     GATE B is guarding a different set than the other. */
  test("GATE B: isFunding flags and FUNDING_CHIP_KEYS name the same four chips", () => {
    const flagged = NEXT_ACTIONS.filter((a) => a.isFunding).map((a) => a.key).sort();
    assert.deepEqual(flagged, [...FUNDING_CHIP_KEYS].sort());
    assert.equal(flagged.length, 4);
  });
});

describe("every chip fires on its own evidence", () => {

  test("Clear Fraud Alert — the tag", () => {
    assert.equal(keyOf(base({ tags: ["fraud:alert-present"] })), "clear_fraud_alert");
  });

  test("Clear Fraud Alert — the round hold reason", () => {
    assert.equal(keyOf(base({ custom_fields: { round_hold_reason: "Fraud Alert" } })), "clear_fraud_alert");
  });

  test("Clear Fraud Alert — a fraud note on the inquiry case", () => {
    assert.equal(
      keyOf(base({ inquiry_cases: [{ case_status: "Queued", fraud_alert_after: "flagged by EX" }] })),
      "clear_fraud_alert"
    );
  });

  test("Clear Fraud Alert says out loud that nothing ever clears it", () => {
    const why = deriveNextAction(base({ tags: ["fraud:alert-present"] })).next_action.why;
    assert.match(why, /nothing in this system ever takes it off/i);
  });

  test("Get Consent — nothing on file", () => {
    assert.equal(keyOf(base({ consent: { valid: false, reason: "none_on_file", consent: null } })), "get_consent");
  });

  test("Get Consent — revoked, and the sentence says so", () => {
    const r = deriveNextAction(base({ consent: { valid: false, reason: "revoked", consent: {} } }));
    assert.equal(r.next_action.key, "get_consent");
    assert.match(r.next_action.why, /took their written permission back/i);
  });

  test("Pull CRS — paid, no result, status not Complete", () => {
    assert.equal(keyOf(base({ custom_fields: { crs_paid: true } })), "pull_crs");
  });

  test("Remove Inquiries — an active case", () => {
    for (const s of ["Queued", "Scheduled", "In Progress", "Escalated", "Blocked"]) {
      assert.equal(keyOf(base({ inquiry_cases: [{ case_status: s }] })), "remove_inquiries", s);
    }
  });

  test("Remove Inquiries does NOT fire on a closed case", () => {
    assert.equal(keyOf(base({ inquiry_cases: [{ case_status: "Completed" }] })), null);
  });

  test("Collect Documents — the docs:missing tag", () => {
    assert.equal(keyOf(base({ tags: ["docs:missing"] })), "collect_documents");
  });

  /* FINDING, recorded not fixed. Chip 5's second route — "the inquiry case is
     Blocked and the identity packet comes back short" — can never be the
     answer under Chris's order. "Blocked" is also one of the five ACTIVE
     inquiry states (src/inquiry-ops/gate.mjs:8), so Remove Inquiries at rank 4
     always fires first. The route is kept because it is the approved mapping
     and it becomes reachable the moment the order changes; this test pins the
     shadowing so it is visible rather than silent. */
  test("Collect Documents — the Blocked-case route is shadowed by Remove Inquiries", () => {
    const r = deriveNextAction(base({
      inquiry_cases: [{ case_status: "Blocked" }],
      doc_packet: { complete: false, missing: ["id_document", "proof_of_address"], present: {} }
    }));
    assert.equal(r.next_action.key, "remove_inquiries");
  });

  test("Review Disputes — an unconfirmed bureau answer", () => {
    assert.equal(keyOf(base({ dispute_responses: [{ id: "d1", confirmed: false }] })), "review_disputes");
  });

  test("Review Disputes — a case past its response due date", () => {
    assert.equal(keyOf(base({
      dispute_cases: [{ status: "awaiting_response", response_due_at: "2026-08-01T00:00:00Z" }]
    })), "review_disputes");
  });

  test("Review Disputes does NOT fire before the due date", () => {
    assert.equal(keyOf(base({
      dispute_cases: [{ status: "awaiting_response", response_due_at: "2026-09-01T00:00:00Z" }]
    })), null);
  });

  test("Review Funding File — CRS complete and an open c-05 review task", () => {
    assert.equal(keyOf(base({
      custom_fields: { crs_status: "Complete" },
      crs_results: [{ is_demo: false }],
      tasks: [{ id: "t1", source_workflow: "c-05-pre-funding-review", done: false }]
    })), "review_funding_file");
  });

  test("Review Funding File does NOT fire on a task already done", () => {
    assert.equal(keyOf(base({
      custom_fields: { crs_status: "Complete" },
      crs_results: [{ is_demo: false }],
      tasks: [{ id: "t1", source_workflow: "c-05-pre-funding-review", done: true }]
    })), null);
  });

  test("Prepare Next Round — the funding card sits on Approved", () => {
    assert.equal(keyOf(base({
      card: { pipeline_key: "funding_card_stacking", stage_key: "approved" }
    })), "prepare_next_round");
  });

  test("Prepare Next Round — the newest round has an approved amount above zero", () => {
    assert.equal(keyOf(base({
      funding_rounds: [{ round_number: 2, status: "started", approved_amount: "35000.00" }]
    })), "prepare_next_round");
  });

  test("Apply for Funding — ready for next round on a funding tier", () => {
    assert.equal(keyOf(base({ custom_fields: { ready_for_next_round: true } })), "apply_for_funding");
  });

  test("Apply for Funding — the funding card sits on Apply Now", () => {
    assert.equal(keyOf(base({
      card: { pipeline_key: "funding_card_stacking", stage_key: "apply_now" }
    })), "apply_for_funding");
  });

  test("Apply Now is the job even with no product tier and an open inquiry", () => {
    const r = deriveNextAction(base({
      outcome_tier: null,
      inquiry_cases: [{ case_status: "Queued" }],
      consent: { valid: false, reason: "none_on_file", consent: null },
      card: { pipeline_key: "funding_card_stacking", stage_key: "apply_now" }
    }));
    assert.equal(r.next_action.key, "apply_for_funding");
    assert.equal(r.next_action.label, "Apply for Funding");
    assert.equal(r.degraded, false);
  });

  test("Apply Now does not give a repair-only file a funding chip", () => {
    const r = deriveNextAction(base({
      outcome_tier: "REPAIR_ONLY",
      card: { pipeline_key: "funding_card_stacking", stage_key: "apply_now" }
    }));
    assert.ok(!FUNDING_CHIP_KEYS.includes(r.next_action?.key ?? null));
  });

  test("Ready to Fund — nothing blocking, no hold, packet complete", () => {
    assert.equal(keyOf(base({
      doc_packet: { complete: true, missing: [], present: {} }
    })), "ready_to_fund");
  });

  test("Ready to Fund does NOT fire while a blocker is open", () => {
    assert.equal(keyOf(base({
      doc_packet: { complete: true, missing: [], present: {} },
      open_blockers: [{ kind: "task", severity: "normal", label: "Invoice client" }]
    })), null);
  });

  test("Ready to Fund does NOT fire while the newest round is on hold", () => {
    assert.equal(keyOf(base({
      doc_packet: { complete: true, missing: [], present: {} },
      funding_rounds: [{ round_number: 1, status: "started", hold_reason: "Internal Review" }]
    })), null);
  });

  test("Ready to Fund does NOT fire when nobody gathered the document packet", () => {
    assert.equal(keyOf(base({ doc_packet: null })), null);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   A BLOCKER LIST NOBODY COULD READ IS NOT AN EMPTY BLOCKER LIST.

   "Ready to Fund" is the one chip whose YES rests on an ABSENCE — it fires when
   NOTHING is blocking the file. So a list that failed to load looks exactly
   like a file with nothing wrong with it. On the client list that list is built
   from three reads (tasks, funding_rounds, v_invoice_balance) and any one of
   them refusing used to leave it empty with nothing marked degraded: an
   unreadable table quietly became "clear to fund". The read layer now says so
   with `blockers_unknown`, and this is what that flag has to do.
   ──────────────────────────────────────────────────────────────────────────── */
describe("an unread blocker list never reads as a clean file", () => {

  const readyToFund = (over = {}) => base({
    doc_packet: { complete: true, missing: [], present: {} },
    ...over
  });

  test("the control — with the list actually read and empty, this client IS Ready to Fund", () => {
    const r = deriveNextAction(readyToFund());
    assert.equal(r.next_action && r.next_action.key, "ready_to_fund");
    assert.equal(r.degraded, false);
  });

  test("the same client with the list unread gets NO instruction, and is marked degraded", () => {
    const r = deriveNextAction(readyToFund({ blockers_unknown: true }));
    assert.equal(r.next_action, null,
      "a file whose blockers could not be read was still called Ready to Fund: " +
      JSON.stringify(r.next_action));
    assert.equal(r.degraded, true,
      "the screen was not told the answer is partial, so it would paint a zero " +
      "blocker count as fact");
  });

  test("an unread list does not take away an answer that never needed it", () => {
    /* GATE A's answer is settled eight chips before Ready to Fund is reached,
       and it does not read blockers at all. Degrading it would replace the
       useful answer ("Get Consent") with nothing, which is the opposite of
       what this flag is for. */
    const r = deriveNextAction(readyToFund({
      consent: { valid: false, reason: "none_on_file", consent: null },
      blockers_unknown: true
    }));
    assert.equal(r.next_action && r.next_action.key, "get_consent");
    assert.equal(r.degraded, false);
  });

  test("a repair-only client is not degraded by a funding-only signal", () => {
    /* GATE B is tested first inside the chip, so a client who can never be
       offered a funding step does not lose their answer to a read that only
       ever fed one. No funding step for a repair-only file is the CORRECT
       answer, not a failure to work one out. */
    const r = deriveNextAction(readyToFund({
      outcome_tier: "REPAIR_ONLY",
      blockers_unknown: true
    }));
    assert.equal(r.next_action, null);
    assert.equal(r.degraded, false,
      "a repair-only file was marked degraded over a blocker list it never needed");
  });

  test("the flag is opt-in — anything but the boolean true is not a failed read", () => {
    for (const v of [undefined, false, null, 0, "", "true"]) {
      assert.equal(keyOf(readyToFund({ blockers_unknown: v })), "ready_to_fund",
        "a client was degraded by a blockers_unknown value of " + JSON.stringify(v));
    }
  });
});

describe("first match wins", () => {

  test("fraud beats documents", () => {
    assert.equal(keyOf(base({ tags: ["fraud:alert-present", "docs:missing"] })), "clear_fraud_alert");
  });

  test("consent beats inquiries", () => {
    assert.equal(keyOf(base({
      consent: { valid: false, reason: "none_on_file", consent: null },
      inquiry_cases: [{ case_status: "Queued" }]
    })), "get_consent");
  });

  test("pull beats inquiries", () => {
    assert.equal(keyOf(base({
      custom_fields: { crs_paid: true },
      inquiry_cases: [{ case_status: "Queued" }]
    })), "pull_crs");
  });

  test("documents beat disputes", () => {
    assert.equal(keyOf(base({
      tags: ["docs:missing"],
      dispute_responses: [{ confirmed: false }]
    })), "collect_documents");
  });

  test("review the funding file beats preparing the next round", () => {
    assert.equal(keyOf(base({
      custom_fields: { crs_status: "Complete" },
      crs_results: [{ is_demo: false }],
      tasks: [{ source_workflow: "c-05-pre-funding-review", done: false }],
      card: { pipeline_key: "funding_card_stacking", stage_key: "approved" }
    })), "review_funding_file");
  });

  test("everything true at once still answers Clear Fraud Alert", () => {
    assert.equal(keyOf(base({
      tags: ["fraud:alert-present", "docs:missing"],
      custom_fields: { crs_paid: true, ready_for_next_round: true, round_hold_reason: "Fraud Alert" },
      consent: { valid: false, reason: "none_on_file", consent: null },
      inquiry_cases: [{ case_status: "Queued" }],
      dispute_responses: [{ confirmed: false }],
      card: { pipeline_key: "funding_card_stacking", stage_key: "approved" },
      doc_packet: { complete: true, missing: [], present: {} }
    })), "clear_fraud_alert");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   GATE A — a client with NO recorded consent NEVER shows "Pull CRS".
   Built twice. Each half is tested at its own seam, so removing EITHER half
   fails a test.
   ══════════════════════════════════════════════════════════════════════════ */
describe("GATE A — no consent, no pull", () => {

  /* ORDERING HALF. Get Consent is what a no-consent client is told to do.
     Delete the ordering rule and the answer stops being "get_consent" — the
     hard guard would refuse the pull and leave null + degraded, so this
     assertion fails either way. */
  test("ordering half: a no-consent client is told to Get Consent, not to pull", () => {
    const r = deriveNextAction(base({
      consent: { valid: false, reason: "none_on_file", consent: null },
      custom_fields: { crs_paid: true }
    }));
    assert.equal(r.next_action.key, "get_consent");
    assert.equal(r.degraded, false);
  });

  /* HARD GUARD HALF, tested directly. Remove the function and this file will
     not even import; weaken it and the assertions fail. It reads no ordering
     and no list of chips, so reordering NEXT_ACTIONS cannot defeat it. */
  test("hard guard half: guardConsentBeforePull refuses Pull CRS without live consent", () => {
    const pull = { key: "pull_crs", label: "Pull CRS", why: "x" };
    assert.equal(guardConsentBeforePull(pull, { consentValid: false }), null);
    assert.equal(guardConsentBeforePull(pull, { consentValid: null }), null);
    assert.equal(guardConsentBeforePull(pull, { consentValid: undefined }), null);
    assert.equal(guardConsentBeforePull(pull, {}), null);
    assert.equal(guardConsentBeforePull(pull), null);
    assert.equal(guardConsentBeforePull(pull, { consentValid: "true" }), null);
    assert.equal(guardConsentBeforePull(pull, { consentValid: 1 }), null);
  });

  test("hard guard half: a live consent lets Pull CRS through unchanged", () => {
    const pull = { key: "pull_crs", label: "Pull CRS", why: "x" };
    assert.equal(guardConsentBeforePull(pull, { consentValid: true }), pull);
  });

  test("hard guard half: the guard touches nothing but Pull CRS", () => {
    const other = { key: "collect_documents", label: "Collect Documents", why: "x" };
    assert.equal(guardConsentBeforePull(other, { consentValid: false }), other);
    assert.equal(guardConsentBeforePull(null, { consentValid: true }), null);
  });

  test("a client with no live consent can NEVER be told to Pull CRS, whatever else is true", () => {
    const consents = [
      { valid: false, reason: "none_on_file", consent: null },
      { valid: false, reason: "revoked", consent: {} },
      { valid: false, reason: "expired", consent: {} },
      { valid: false, reason: "not_yet_effective", consent: {} },
      { valid: false, reason: "no_org_scope", consent: null },
      undefined,
      null,
      "yes",
      {}
    ];
    const shapes = [
      { custom_fields: { crs_paid: true } },
      { custom_fields: { crs_paid: true, crs_status: "Requested" } },
      { custom_fields: { crs_paid: true }, crs_results: [{ is_demo: true }] },
      { custom_fields: { crs_paid: true }, real_crs_result_count: 0 },
      { custom_fields: { crs_paid: true }, inquiry_cases: [{ case_status: "Queued" }] },
      { custom_fields: { crs_paid: true }, tags: ["docs:missing"] }
    ];
    for (const consent of consents) {
      for (const shape of shapes) {
        const r = deriveNextAction(base({ consent, ...shape }));
        assert.notEqual(r.next_action?.key, "pull_crs",
          `${JSON.stringify(consent)} + ${JSON.stringify(shape)}`);
      }
    }
  });

  test("a client whose credit is already in is NOT blocked on consent", () => {
    // Real result on file, no consent row. Rank 2 must not fire: the point of
    // Get Consent is to unblock a pull, and there is nothing left to unblock.
    assert.equal(keyOf(base({
      consent: { valid: false, reason: "none_on_file", consent: null },
      crs_results: [{ is_demo: false }],
      custom_fields: { crs_status: "Complete" }
    })), null);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   GATE B — repair-only clients NEVER see a funding chip.
   Built twice. Each half tested at its own seam.
   ══════════════════════════════════════════════════════════════════════════ */
describe("GATE B — repair-only never sees funding", () => {

  const everyFundingConditionTrue = (over = {}) => base({
    custom_fields: { crs_status: "Complete", ready_for_next_round: true },
    crs_results: [{ is_demo: false }],
    tasks: [{ source_workflow: "c-05-pre-funding-review", done: false }],
    card: { pipeline_key: "funding_card_stacking", stage_key: "approved" },
    funding_rounds: [{ round_number: 2, status: "started", approved_amount: "40000.00" }],
    doc_packet: { complete: true, missing: [], present: {} },
    ...over
  });

  /* ORDERING HALF. Each funding chip's own predicate refuses a non-funding
     product, so the walk simply never selects one and the honest answer is
     "nothing to do" — degraded:false. Delete that predicate and a funding chip
     IS selected; the hard guard then drops it and sets degraded:true, so this
     test fails on the degraded assertion. */
  test("ordering half: a repair-only client with every funding condition true gets a truthful nothing", () => {
    const r = deriveNextAction(everyFundingConditionTrue({ outcome_tier: "REPAIR_ONLY" }));
    assert.equal(r.next_action, null);
    assert.equal(r.degraded, false, "the ordering rule must skip funding chips, not the guard");
  });

  test("ordering half: the same client on a funding tier does get a funding chip", () => {
    const r = deriveNextAction(everyFundingConditionTrue({ outcome_tier: "FULL_FUNDING" }));
    assert.equal(r.next_action.key, "review_funding_file");
    assert.equal(r.degraded, false);
  });

  /* ORDERING HALF, AND IT MUST BE A WHITELIST. fundingChipsAllowed() has to
     answer "is this ONE OF THE THREE FUNDING TIERS?" — not "is this anything
     other than repair-only?". The two agree on every tier that exists today,
     which is why the REPAIR_ONLY test above passes either way and why a
     mutation pass found this half untested. They stop agreeing the moment
     anyone adds a tier: a blacklist lets every unrecognised value THROUGH,
     which is failing open on a compliance gate. src/config/product-path.mjs
     names six tiers and only three of them are funding ones.

     WHAT BREAKS IF IT BECOMES A BLACKLIST: the funding chip is selected, the
     hard guard downstream then refuses it, and the whole answer is dropped as
     degraded. So the tell is `degraded`, not the chip — the chip is caught by
     the second layer either way. That is what this asserts. */
  test("ordering half: a tier that is not one of the three funding tiers is refused by the ordering rule, not by the guard", () => {
    for (const tier of ["MANUAL_REVIEW", "FRAUD_HOLD", "PREMIUM_STACK_V2", "", null, undefined, 42]) {
      const r = deriveNextAction(everyFundingConditionTrue({ outcome_tier: tier }));
      assert.equal(r.next_action, null,
        `tier ${JSON.stringify(tier)} was handed a funding chip: ${JSON.stringify(r.next_action)}`);
      assert.equal(r.degraded, false,
        `tier ${JSON.stringify(tier)}: a funding chip got past the ordering rule and the hard ` +
        `guard had to catch it. GATE B's ordering half must be a WHITELIST of the three ` +
        `funding tiers — "not repair-only" fails open on every tier value nobody has met yet.`);
    }
  });

  test("ordering half: the whitelist is not so tight it refuses the tiers that ARE funding", () => {
    // The control for the test above: proving a whitelist is worth nothing if
    // the whitelist turns out to be empty.
    for (const tier of ["FUNDING_PLUS_REPAIR", "FULL_FUNDING", "PREMIUM_STACK"]) {
      const r = deriveNextAction(everyFundingConditionTrue({ outcome_tier: tier }));
      assert.equal(r.next_action && r.next_action.key, "review_funding_file", `tier ${tier}`);
      assert.equal(r.degraded, false, `tier ${tier}`);
    }
  });

  test("ordering half: a repair-only client still gets their non-funding chips", () => {
    const r = deriveNextAction(everyFundingConditionTrue({
      outcome_tier: "REPAIR_ONLY",
      dispute_responses: [{ confirmed: false }]
    }));
    assert.equal(r.next_action.key, "review_disputes");
    assert.equal(r.degraded, false);
  });

  /* HARD GUARD HALF, tested directly. Remove the function and this file will
     not import; weaken it and the assertions fail. It reads FUNDING_CHIP_KEYS,
     never NEXT_ACTIONS, so reordering cannot defeat it. */
  test("hard guard half: guardFundingProduct refuses every funding chip for repair-only", () => {
    for (const key of FUNDING_CHIP_KEYS) {
      const action = { key, label: key, why: "x" };
      assert.equal(guardFundingProduct(action, { outcomeTier: "REPAIR_ONLY" }), null, key);
    }
  });

  test("hard guard half: it fails closed on an unknown or missing product", () => {
    for (const key of FUNDING_CHIP_KEYS) {
      const action = { key, label: key, why: "x" };
      for (const tier of [null, undefined, "", "MANUAL_REVIEW", "FRAUD_HOLD", "SOMETHING_NEW", 42]) {
        assert.equal(guardFundingProduct(action, { outcomeTier: tier }), null, `${key} / ${tier}`);
      }
      assert.equal(guardFundingProduct(action, {}), null, key);
      assert.equal(guardFundingProduct(action), null, key);
    }
  });

  test("hard guard half: the three funding tiers are let through unchanged", () => {
    for (const key of FUNDING_CHIP_KEYS) {
      for (const tier of ["FUNDING_PLUS_REPAIR", "FULL_FUNDING", "PREMIUM_STACK"]) {
        const action = { key, label: key, why: "x" };
        assert.equal(guardFundingProduct(action, { outcomeTier: tier }), action, `${key} / ${tier}`);
      }
    }
  });

  test("hard guard half: it touches nothing that is not a funding chip", () => {
    const other = { key: "collect_documents", label: "Collect Documents", why: "x" };
    assert.equal(guardFundingProduct(other, { outcomeTier: "REPAIR_ONLY" }), other);
    assert.equal(guardFundingProduct(null, { outcomeTier: "FULL_FUNDING" }), null);
  });

  test("a repair-only client can NEVER be given a funding chip, whatever else is true", () => {
    const shapes = [
      { custom_fields: { ready_for_next_round: true } },
      { card: { pipeline_key: "funding_card_stacking", stage_key: "approved" } },
      { funding_rounds: [{ round_number: 9, status: "started", approved_amount: "1.00" }] },
      { doc_packet: { complete: true, missing: [], present: {} } },
      {
        custom_fields: { crs_status: "Complete" },
        crs_results: [{ is_demo: false }],
        tasks: [{ source_workflow: "c-05-pre-funding-review", done: false }]
      }
    ];
    for (const tier of ["REPAIR_ONLY", null, undefined, "MANUAL_REVIEW", "FRAUD_HOLD"]) {
      for (const shape of shapes) {
        const r = deriveNextAction(base({ outcome_tier: tier, ...shape }));
        const key = r.next_action?.key ?? null;
        assert.ok(!FUNDING_CHIP_KEYS.includes(key),
          `${tier} got ${key} from ${JSON.stringify(shape)}`);
      }
    }
  });
});

describe("a demo row is not a real pull", () => {

  test("a demo-only credit row still leaves Pull CRS as the next action", () => {
    assert.equal(keyOf(base({
      custom_fields: { crs_paid: true },
      crs_results: [{ id: "c1", is_demo: true }]
    })), "pull_crs");
  });

  test("several demo rows still leave Pull CRS as the next action", () => {
    assert.equal(keyOf(base({
      custom_fields: { crs_paid: true },
      crs_results: [{ is_demo: true }, { is_demo: true }, { is_demo: true }]
    })), "pull_crs");
  });

  test("one real row alongside demo rows counts as pulled", () => {
    assert.equal(keyOf(base({
      custom_fields: { crs_paid: true },
      crs_results: [{ is_demo: true }, { is_demo: false }]
    })), null);
  });

  test("a supplied real count is accepted for list screens", () => {
    assert.equal(keyOf(base({
      custom_fields: { crs_paid: true }, crs_results: undefined, real_crs_result_count: 0
    })), "pull_crs");
    assert.equal(keyOf(base({
      custom_fields: { crs_paid: true }, crs_results: undefined, real_crs_result_count: 2
    })), null);
  });
});

describe("money — NULL means unknown and survives", () => {

  test("a NULL approved amount stays NULL and never becomes zero", () => {
    const r = deriveNextAction(base({
      funding_rounds: [{ round_number: 2, status: "started", approved_amount: null, hold_reason: null }]
    }));
    assert.equal(r.funding_round.approved_amount, null);
    assert.notEqual(r.funding_round.approved_amount, 0);
  });

  test("a NULL approved amount does NOT fire Prepare Next Round", () => {
    assert.equal(keyOf(base({
      funding_rounds: [{ round_number: 2, status: "started", approved_amount: null }]
    })), null);
  });

  test("a zero approved amount does NOT fire Prepare Next Round", () => {
    assert.equal(keyOf(base({
      funding_rounds: [{ round_number: 2, status: "started", approved_amount: "0.00" }]
    })), null);
  });

  test("the amount is passed through exactly as it arrived from Postgres", () => {
    const r = deriveNextAction(base({
      funding_rounds: [{ round_number: 1, status: "funded", approved_amount: "50000.00" }]
    }));
    assert.equal(r.funding_round.approved_amount, "50000.00");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   GATE B COVERS THE MONEY, NOT ONLY THE CHIP

   A funding round carries an approved amount. Handing one back for a
   REPAIR_ONLY client puts "approved $75,000" in front of somebody who never
   bought funding — no chip is involved, so guardFundingProduct() never sees
   it. Same whitelist, same helper: the round is refused on exactly the tiers a
   funding chip is refused on, and an unknown tier fails closed.
   ──────────────────────────────────────────────────────────────────────────── */

describe("the funding round is gated on the same tiers the chips are", () => {

  const withRound = (tier) => deriveNextAction(base({
    outcome_tier: tier,
    funding_rounds: [{ round_number: 1, status: "approved", approved_amount: "75000.00" }]
  }));

  test("a REPAIR_ONLY client with a funding round row gets no round at all", () => {
    const r = withRound("REPAIR_ONLY");
    assert.equal(r.funding_round, null,
      "a repair-only client is being shown funding money they never bought");
    assert.equal(JSON.stringify(r).indexOf("75000"), -1,
      "the approved amount reached the screen by another key: " + JSON.stringify(r));
  });

  test("an unknown, missing or non-funding tier fails closed too", () => {
    for (const tier of [null, undefined, "", "MANUAL_REVIEW", "FRAUD_HOLD", "SOMETHING_NEW", 7, {}]) {
      assert.equal(withRound(tier).funding_round, null,
        "a tier of " + JSON.stringify(tier) + " let funding money through");
    }
  });

  test("the three funding tiers still get their round, money and all", () => {
    for (const tier of ["FUNDING_PLUS_REPAIR", "FULL_FUNDING", "PREMIUM_STACK"]) {
      const r = withRound(tier);
      assert.ok(r.funding_round, tier + " lost its funding round");
      assert.equal(r.funding_round.number, 1, tier);
      assert.equal(r.funding_round.approved_amount, "75000.00", tier);
    }
  });

  test("refusing the money is not a failure to work the file out", () => {
    const r = withRound("REPAIR_ONLY");
    assert.equal(r.degraded, false,
      "declining to show funding money to a repair client is the right answer, " +
      "not a signal that we could not read the file");
  });

  test("the round is refused on exactly the tiers a funding chip is refused on", () => {
    const tiers = ["REPAIR_ONLY", "FULL_FUNDING", "FUNDING_PLUS_REPAIR", "PREMIUM_STACK",
      "MANUAL_REVIEW", "FRAUD_HOLD", null, undefined, "", "SOMETHING_NEW"];
    for (const tier of tiers) {
      const chip = { key: FUNDING_CHIP_KEYS[0], label: "x", why: "y" };
      const chipAllowed = guardFundingProduct(chip, { outcomeTier: tier }) !== null;
      const roundShown = withRound(tier).funding_round !== null;
      assert.equal(roundShown, chipAllowed,
        "the round and the chip disagree about " + JSON.stringify(tier) +
        " — there has to be one whitelist, not two");
    }
  });
});

describe("the funding round summary", () => {

  test("no rounds means null, not an empty shell", () => {
    assert.equal(deriveNextAction(base()).funding_round, null);
  });

  test("the highest round number wins whatever order the rows arrive in", () => {
    const r = deriveNextAction(base({
      funding_rounds: [
        { round_number: 1, status: "closed", approved_amount: "10.00" },
        { round_number: 3, status: "started", approved_amount: null },
        { round_number: 2, status: "funded", approved_amount: "20.00" }
      ]
    }));
    assert.equal(r.funding_round.number, 3);
    assert.equal(r.funding_round.approved_amount, null);
  });

  test("finalized is true only at a terminal status", () => {
    const at = (status) => deriveNextAction(base({
      funding_rounds: [{ round_number: 1, status }]
    })).funding_round.finalized;
    assert.equal(at("funded"), true);
    assert.equal(at("closed"), true);
    assert.equal(at("Funded"), true);
    assert.equal(at("started"), false);
    assert.equal(at("submitted"), false);
  });

  test("finalized is null — not false — when there is no status to read", () => {
    const r = deriveNextAction(base({ funding_rounds: [{ round_number: 1 }] }));
    assert.equal(r.funding_round.finalized, null);
    assert.equal(r.funding_round.status, null);
  });

  test("a blank hold reason reads as no hold", () => {
    const r = deriveNextAction(base({
      funding_rounds: [{ round_number: 1, status: "started", hold_reason: "   " }]
    }));
    assert.equal(r.funding_round.hold_reason, null);
  });
});

describe("active blockers — reused, not rebuilt", () => {

  test("openBlockers rows pass straight through, with a key added", () => {
    const r = deriveNextAction(base({
      open_blockers: [
        { kind: "task", severity: "normal", label: "Invoice client", detail: "owned by funding_advisor", id: "t1" },
        { kind: "funding_hold", severity: "high", label: "Round 2 on hold", detail: "Internal Review", id: "r2" }
      ]
    }));
    assert.equal(r.active_blockers.length, 2);
    assert.equal(r.active_blockers[0].key, "funding_hold");   // high first, as openBlockers ranks
    assert.equal(r.active_blockers[0].label, "Round 2 on hold");
    assert.equal(r.active_blockers[0].detail, "Internal Review");
    assert.equal(r.active_blockers[1].key, "task");
    for (const b of r.active_blockers) {
      assert.equal(typeof b.key, "string");
      assert.equal(typeof b.label, "string");
      assert.ok(["high", "normal"].includes(b.severity));
    }
  });

  test("the fraud alert is added — openBlockers cannot see it", () => {
    const r = deriveNextAction(base({ tags: ["fraud:alert-present"] }));
    const fraud = r.active_blockers.find((b) => b.key === "fraud_alert");
    assert.ok(fraud, "fraud alert must appear as its own blocker");
    assert.equal(fraud.severity, "high");
    assert.match(fraud.detail, /ever clears a fraud alert/i);
  });

  test("the fraud alert is still added when its task has been ticked off", () => {
    // This is the whole reason it is not left to openBlockers: the task can be
    // marked done, and nothing ever clears the alert itself.
    const r = deriveNextAction(base({
      tags: ["fraud:alert-present"],
      open_blockers: [],
      tasks: [{ source_workflow: "c-03-inquiry-removed-resume-or-hold", done: true }]
    }));
    assert.ok(r.active_blockers.some((b) => b.key === "fraud_alert"));
  });

  test("missing consent is added — openBlockers does not read consent", () => {
    const r = deriveNextAction(base({ consent: { valid: false, reason: "revoked", consent: {} } }));
    const c = r.active_blockers.find((b) => b.key === "consent_missing");
    assert.ok(c);
    assert.equal(c.severity, "high");
  });

  /* THE DEFECT THIS CLOSES. A failed consent read used to add nothing at all,
     while the pull-credit relabel above fired anyway — so the screen said
     "waiting on written permission" and nothing anywhere said we had never
     managed to check. "We looked and there is none" and "we could not look"
     are different facts and staff act on them differently. */
  test("a consent read that failed says we could not check — never that permission is missing", () => {
    const r = deriveNextAction(base({ consent: undefined }));
    assert.ok(!r.active_blockers.some((b) => b.key === "consent_missing"),
      "we did not look, so we may not report that there is nothing on file");
    const c = r.active_blockers.find((b) => b.key === "consent_unknown");
    assert.ok(c, "a consent read that failed left nothing on screen saying so: " +
      JSON.stringify(r.active_blockers));
    assert.equal(c.severity, "high");
    assert.match(c.label, /could not check/i);
    assert.doesNotMatch(c.label, /pull/i);
    assert.match(c.detail, /could not be read/i,
      "the detail has to say the record could not be read, not that permission is absent");
  });

  test("the two consent blockers are never both raised — one fact, one card", () => {
    for (const consent of [
      { valid: false, reason: "none_on_file", consent: null },
      { valid: true, reason: "valid", consent: {} },
      undefined
    ]) {
      const keys = deriveNextAction(base({ consent })).active_blockers.map((b) => b.key);
      const both = keys.includes("consent_missing") && keys.includes("consent_unknown");
      assert.ok(!both, "two contradicting consent cards at once: " + JSON.stringify(keys));
    }
  });

  test("live permission raises neither consent blocker", () => {
    const keys = deriveNextAction(base()).active_blockers.map((b) => b.key);
    assert.deepEqual(keys, []);
  });

  test("blockers are ranked high first", () => {
    const r = deriveNextAction(base({
      tags: ["fraud:alert-present"],
      open_blockers: [{ kind: "task", severity: "normal", label: "Chase docs" }]
    }));
    assert.equal(r.active_blockers[0].severity, "high");
  });
});

/* GATE A ON THE BLOCKER LIST.

   openBlockers() passes an open task's TITLE through verbatim as `label`, and
   src/workflows/s-06-post-call-funding-purchased.mjs:25 raises a task titled
   "Funding intake — pull CRS". That label is painted as a pill on the pipeline
   lens and as a card on the client control panel, so without this a client with
   no recorded permission was shown the words "pull CRS" as the thing to do.

   Chris's rule is literal. The blocker STAYS — it is real, and hiding it would
   be a lie by omission — but the words change. */
describe("a blocker never tells anyone to pull credit without permission", () => {

  // Exactly the row openBlockers() builds from that task.
  const pullTask = {
    kind: "task", severity: "normal",
    label: "Funding intake — pull CRS",
    detail: "owned by closer",
    source: "s-06-post-call-funding-purchased",
    id: "t9"
  };
  const found = (r) => r.active_blockers.find((b) => b.id === "t9");

  test("no permission on file — the pill does not say pull", () => {
    const r = deriveNextAction(base({
      consent: { valid: false, reason: "none_on_file", consent: null },
      open_blockers: [pullTask]
    }));
    const b = found(r);
    assert.ok(b, "the blocker must still be there — it is real, and hiding it is a lie");
    assert.doesNotMatch(b.label, /pull/i,
      "a client with no written permission was shown a pill telling someone to pull credit");
    assert.equal(b.label, "Funding intake — waiting on written permission");
    assert.equal(b.recorded_label, "Funding intake — pull CRS",
      "the words on the record must survive, labelled as the record and never as an instruction");
  });

  test("permission taken back — same answer", () => {
    const r = deriveNextAction(base({
      consent: { valid: false, reason: "revoked", consent: {} },
      open_blockers: [pullTask]
    }));
    assert.doesNotMatch(found(r).label, /pull/i);
  });

  test("nobody asked about permission — still refused, fail closed", () => {
    // consent absent is "we did not look", and that is not permission.
    const r = deriveNextAction(base({ consent: undefined, open_blockers: [pullTask] }));
    assert.doesNotMatch(found(r).label, /pull/i);
  });

  /* THE SECOND DEFECT. The relabel fired on anything that was not a live
     consent, but it only had ONE set of words — the words for "we checked and
     there is no permission". A consent read that failed therefore put a fact
     on screen that nobody had verified. Two states, two sentences. */
  test("a consent read that FAILED says we could not check, not that they are waiting on permission", () => {
    const r = deriveNextAction(base({ consent: undefined, open_blockers: [pullTask] }));
    const b = found(r);
    assert.equal(b.label, "Funding intake — we could not check written permission");
    assert.doesNotMatch(b.label, /waiting on/i,
      "the label claims we know they have no permission, and we never managed to look");
    assert.equal(b.recorded_label, "Funding intake — pull CRS");
  });

  test("a consent we DID check and found bad still reads as waiting on permission", () => {
    const r = deriveNextAction(base({
      consent: { valid: false, reason: "none_on_file", consent: null },
      open_blockers: [pullTask]
    }));
    assert.equal(found(r).label, "Funding intake — waiting on written permission");
  });

  test("the two refusals are two different sentences", () => {
    const checked = deriveNextAction(base({
      consent: { valid: false, reason: "none_on_file", consent: null },
      open_blockers: [pullTask]
    }));
    const unchecked = deriveNextAction(base({ consent: undefined, open_blockers: [pullTask] }));
    assert.notEqual(found(checked).label, found(unchecked).label,
      "'we checked and there is none' and 'we could not check' read the same, so staff " +
      "cannot tell them apart");
  });

  test("no blocker anywhere in the list tells anyone to pull", () => {
    const r = deriveNextAction(base({
      consent: { valid: false, reason: "none_on_file", consent: null },
      open_blockers: [pullTask]
    }));
    for (const b of r.active_blockers) {
      assert.doesNotMatch(String(b.label), /pull/i);
    }
  });

  test("live permission — the real title is shown, untouched", () => {
    const r = deriveNextAction(base({ open_blockers: [pullTask] }));
    const b = found(r);
    assert.equal(b.label, "Funding intake — pull CRS",
      "with written permission on file there is nothing to keep from anyone");
    assert.equal(b.recorded_label, undefined);
  });

  test("every other blocker is left exactly as it was — this is not a text scrubber", () => {
    const r = deriveNextAction(base({
      consent: { valid: false, reason: "none_on_file", consent: null },
      open_blockers: [
        { kind: "task", severity: "normal", label: "Chase docs", source: "f-02-doc-chase", id: "t1" },
        { kind: "balance_due", severity: "high", label: "Invoice overdue", source: "invoices", id: "i1" }
      ]
    }));
    const docs = r.active_blockers.find((b) => b.id === "t1");
    const inv = r.active_blockers.find((b) => b.id === "i1");
    assert.equal(docs.label, "Chase docs");
    assert.equal(docs.recorded_label, undefined);
    assert.equal(inv.label, "Invoice overdue");
    assert.equal(inv.recorded_label, undefined);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE SANITIZER ITSELF — the ONE place the relabel happens.

   THE DEFECT THIS CLOSES. The relabel used to live inside the derivation, so
   only `active_blockers` came out safe. GET /api/dashboard/client also returns
   the RAW open_blockers array and the client control panel paints it directly
   in two more places, so a real no-consent client had the top panel reading
   "Funding intake — pull CRS" while the block below it read "waiting on
   written permission". The read layer now runs this same function on the array
   it emits — see api/dashboard/client.mjs — which is why every consumer is
   safe without knowing it has to ask.
   ══════════════════════════════════════════════════════════════════════════ */
describe("sanitizeBlockerLabels — one relabel, every consumer", () => {

  const pullTask = () => ({
    kind: "task", severity: "normal",
    label: "Funding intake — pull CRS",
    detail: "owned by closer",
    source: "s-06-post-call-funding-purchased",
    id: "t9"
  });

  test("no permission on file — the words change and nothing else does", () => {
    const [b] = sanitizeBlockerLabels([pullTask()], { consentValid: false });
    assert.equal(b.label, "Funding intake — waiting on written permission");
    assert.equal(b.recorded_label, "Funding intake — pull CRS");
    // RELABEL, NOT HIDE: everything a closer acts on has to survive.
    assert.equal(b.id, "t9");
    assert.equal(b.kind, "task");
    assert.equal(b.detail, "owned by closer");
    assert.equal(b.severity, "normal");
    assert.equal(b.source, "s-06-post-call-funding-purchased");
  });

  test("the consent read failed — the honest words, and still refused", () => {
    for (const opts of [{ consentValid: null }, { consentValid: undefined }, {}, undefined]) {
      const [b] = sanitizeBlockerLabels([pullTask()], opts);
      assert.equal(b.label, "Funding intake — we could not check written permission",
        "fail closed: " + JSON.stringify(opts));
      assert.doesNotMatch(b.label, /pull/i);
    }
  });

  test("live permission — the real title passes through byte for byte", () => {
    const row = pullTask();
    const out = sanitizeBlockerLabels([row], { consentValid: true });
    assert.equal(out[0].label, "Funding intake — pull CRS");
    assert.equal(out[0].recorded_label, undefined);
    assert.deepEqual(out[0], row);
  });

  test("only a boolean true is permission — a truthy lookalike is not", () => {
    for (const v of ["true", 1, "yes", {}, [], "valid"]) {
      const [b] = sanitizeBlockerLabels([pullTask()], { consentValid: v });
      assert.doesNotMatch(b.label, /pull/i, "a " + JSON.stringify(v) + " consent let the words through");
    }
  });

  /* THIS TEST'S PREMISE CHANGED ON PURPOSE, 2026-08-19.
     It used to assert the opposite — that a hand-typed title is NEVER rewritten,
     because the match was on the workflow id alone. An adversary then showed a
     pull-credit task reaching a real screen raw whenever source_workflow was NULL
     or belonged to any other workflow. Gate A is non-negotiable, so the words are
     now a second test behind the source match. The two cases below pin the line:
     wording that tells someone to pull credit is rewritten, everything else is
     still left exactly alone. */
  test("the words are a backstop: pull-credit wording is rewritten whoever raised it", () => {
    const typed = { kind: "task", label: "Ring them about the CRS pull", source: "f-02-doc-chase", id: "t1" };
    const [b] = sanitizeBlockerLabels([typed], { consentValid: false });
    assert.notEqual(b.label, typed.label, "a pull-credit task slipped through on a non-s-06 source");
    assert.ok(!/pull/i.test(b.label), `still telling someone to pull: ${b.label}`);
    assert.equal(b.recorded_label, "Ring them about the CRS pull", "the words on the record were lost");
    assert.equal(b.source, "f-02-doc-chase", "the row lost its source");
    assert.equal(b.id, "t1", "the row lost its id");
  });

  test("a NULL source_workflow cannot smuggle it past — openBlockers sends the literal 'task'", () => {
    const orphan = { kind: "task", label: "Funding intake — pull CRS", source: "task", id: "t9" };
    const [b] = sanitizeBlockerLabels([orphan], { consentValid: false });
    assert.ok(!/pull/i.test(b.label), `the exact adversary case leaked: ${b.label}`);
  });

  test("it is still not a blanket scrubber — an unrelated title is untouched", () => {
    const typed = { kind: "task", label: "Chase the signed contract", source: "f-02-doc-chase", id: "t2" };
    const [b] = sanitizeBlockerLabels([typed], { consentValid: false });
    assert.deepEqual(b, typed, "an unrelated human task title was rewritten");
  });

  test("with permission on file even pull-credit wording passes through byte for byte", () => {
    const typed = { kind: "task", label: "Ring them about the CRS pull", source: "f-02-doc-chase", id: "t1" };
    const [b] = sanitizeBlockerLabels([typed], { consentValid: true });
    assert.deepEqual(b, typed, "a real title was rewritten while the pull was allowed");
  });

  test("running it twice keeps the words on the record, never our own label", () => {
    const once = sanitizeBlockerLabels([pullTask()], { consentValid: false });
    const twice = sanitizeBlockerLabels(once, { consentValid: false });
    assert.equal(twice[0].recorded_label, "Funding intake — pull CRS",
      "the second pass recorded the safe label as if it were what staff wrote");
    assert.equal(twice[0].label, "Funding intake — waiting on written permission");
    assert.deepEqual(twice[0], once[0]);
  });

  test("it never throws and never drops a row", () => {
    for (const bad of [null, undefined, "x", 42, {}, [null], [undefined], ["x"], [[]]]) {
      const out = sanitizeBlockerLabels(bad, { consentValid: false });
      assert.ok(Array.isArray(out), JSON.stringify(bad));
      if (Array.isArray(bad)) assert.equal(out.length, bad.length, JSON.stringify(bad));
    }
    const hostile = [{ get source() { throw new Error("boom"); }, label: "Funding intake — pull CRS" }];
    const out = sanitizeBlockerLabels(hostile, { consentValid: null });
    assert.equal(out.length, 1, "a row we cannot read must keep its place in the list");
    assert.doesNotMatch(String(out[0].label), /pull/i,
      "a row we could not read let its own words through");
  });
});

describe("the empty client — a truthful answer, not a crash", () => {

  test("no rows at all, nothing consented: the honest answer is Get Consent", () => {
    const r = deriveNextAction({
      outcome_tier: null,
      tags: [],
      custom_fields: {},
      consent: { valid: false, reason: "none_on_file", consent: null },
      crs_results: [],
      inquiry_cases: [],
      doc_packet: null,
      dispute_responses: [],
      dispute_cases: [],
      tasks: [],
      funding_rounds: [],
      card: null,
      open_blockers: []
    });
    assert.equal(r.next_action.key, "get_consent");
    assert.equal(r.degraded, false);
    assert.equal(r.funding_round, null);
    assert.deepEqual(r.active_blockers.map((b) => b.key), ["consent_missing"]);
  });

  test("no rows at all, consent already on file: nothing to do, and we say so", () => {
    const r = deriveNextAction(base({ outcome_tier: null }));
    assert.equal(r.next_action, null);
    assert.equal(r.degraded, false);
    assert.deepEqual(r.active_blockers, []);
    assert.equal(r.funding_round, null);
  });
});

describe("honest degrade — we say when we could not tell", () => {

  const shape = (r) => {
    assert.equal(r.next_action, null);
    assert.equal(r.degraded, true);
  };

  test("a malformed input returns the fallback and never throws", () => {
    for (const bad of [null, undefined, "x", 42, true, [], [1, 2, 3], NaN, Symbol("s")]) {
      const r = deriveNextAction(bad);
      assert.deepEqual(r, {
        next_action: null, active_blockers: [], funding_round: null, degraded: true
      }, String(bad?.toString?.() ?? bad));
    }
  });

  test("an input that throws while being read returns the fallback", () => {
    const hostile = {
      get custom_fields() { throw new Error("boom"); }
    };
    assert.deepEqual(deriveNextAction(hostile), {
      next_action: null, active_blockers: [], funding_round: null, degraded: true
    });
  });

  test("consent never gathered degrades rather than guessing", () => {
    shape(deriveNextAction(base({ consent: undefined })));
    shape(deriveNextAction(base({ consent: null })));
    shape(deriveNextAction(base({ consent: "valid" })));
    shape(deriveNextAction(base({ consent: { reason: "valid" } })));
  });

  test("credit evidence never gathered degrades rather than guessing", () => {
    shape(deriveNextAction(base({
      custom_fields: { crs_paid: true }, crs_results: undefined, real_crs_result_count: undefined
    })));
  });

  test("tags never gathered degrades — we cannot say there is no fraud alert", () => {
    shape(deriveNextAction(base({ tags: undefined })));
    shape(deriveNextAction(base({ tags: "fraud:alert-present" })));
  });

  test("custom fields never gathered degrades", () => {
    shape(deriveNextAction(base({ custom_fields: undefined })));
    shape(deriveNextAction(base({ custom_fields: "crs_paid=true" })));
  });

  test("a degraded answer still carries what we COULD see", () => {
    const r = deriveNextAction(base({
      tags: undefined,
      open_blockers: [{ kind: "task", severity: "normal", label: "Chase docs" }],
      funding_rounds: [{ round_number: 4, status: "started", approved_amount: null }]
    }));
    assert.equal(r.degraded, true);
    assert.equal(r.next_action, null);
    assert.equal(r.active_blockers.length, 1);
    assert.equal(r.funding_round.number, 4);
    assert.equal(r.funding_round.approved_amount, null);
  });

  test("a fact we CAN read still answers, even when another signal is missing", () => {
    // The hold reason proves the fraud alert on its own, so a missing tags
    // column does not stop us naming the next action.
    const r = deriveNextAction(base({
      tags: undefined,
      custom_fields: { round_hold_reason: "Fraud Alert" }
    }));
    assert.equal(r.next_action.key, "clear_fraud_alert");
    assert.equal(r.degraded, false);
  });

  test("the answer is always the promised shape", () => {
    const inputs = [
      base(),
      base({ tags: ["fraud:alert-present"] }),
      base({ consent: undefined }),
      {},
      null
    ];
    for (const input of inputs) {
      const r = deriveNextAction(input);
      assert.deepEqual(Object.keys(r).sort(),
        ["active_blockers", "degraded", "funding_round", "next_action"]);
      assert.equal(typeof r.degraded, "boolean");
      assert.ok(Array.isArray(r.active_blockers));
      if (r.next_action !== null) {
        assert.deepEqual(Object.keys(r.next_action).sort(), ["key", "label", "why"]);
        assert.equal(typeof r.next_action.why, "string");
        assert.ok(r.next_action.why.length > 0);
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   DEFENCE IN DEPTH — the three guards no input can reach today.

   Both compliance gates are built twice on purpose, and an adversary pass
   fuzzed 212,160 inputs through this module with the three guards below
   removed and got byte-identical output every time. They are, today,
   unreachable. THEY STAY IN, and this block is what stops the next person
   deleting them as dead code.

   WHY THEY CANNOT BE REACHED, AND WHY THAT IS NOT A REASON TO DROP THEM:

     * evaluatePullCrs()'s own consent belt. "Get Consent" ranks above
       "Pull CRS" and answers YES or UNKNOWN for every client without live
       permission, so the walk stops before Pull CRS is ever evaluated. The
       belt is unreachable only for as long as that ranking holds. Move one
       line in NEXT_ACTIONS and it becomes the thing standing between a
       client who signed nothing and an instruction to pull their credit.

     * the two guard calls in deriveNextAction(). They only fire when the
       ordering above them is already wrong. Today it is right, so they never
       fire. That is what a backstop looks like when the thing in front of it
       is working.

   A behavioural test is therefore impossible: there is no input that tells
   the three of them apart from their absence. So these are STRUCTURAL — they
   read the source and assert the lines are still there. A structural test is
   the weakest kind and it is the right kind here, because the failure being
   guarded against is an edit, not an input.
   ══════════════════════════════════════════════════════════════════════════ */
describe("defence in depth: the guards that cannot fire today", () => {
  const src = readFileSync(new URL("./next-action.mjs", import.meta.url), "utf8");

  const sliceBetween = (from, to) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to);
    assert.ok(a !== -1 && b > a, `could not find ${from} … ${to} in next-action.mjs`);
    return src.slice(a, b);
  };

  test("GATE A: Pull CRS keeps its own consent belt, under its own predicate", () => {
    const fn = sliceBetween("function evaluatePullCrs", "/* 4. REMOVE INQUIRIES");
    assert.match(fn, /if\s*\(\s*ctx\.consentValid\s*!==\s*true\s*\)\s*return\s+NO\(\)/,
      "Pull CRS lost its own consent check. It is unreachable while Get Consent " +
      "outranks it — and it is the only thing left if that ranking is ever changed. " +
      "GATE A is Chris's non-negotiable: no recorded permission, never Pull CRS.");
  });

  test("GATE A: deriveNextAction still runs the hard consent guard on the final answer", () => {
    const fn = sliceBetween("export function deriveNextAction", "\n    return {");
    assert.match(fn, /guardConsentBeforePull\(\s*chosen\s*,/,
      "the hard consent guard is no longer called on the chosen action");
    assert.match(fn, /!==\s*chosen\s*\)\s*\{[\s\S]{0,120}degraded\s*=\s*true/,
      "a guard that refuses must DROP the answer and mark it degraded, never " +
      "quietly swap in a different chip");
  });

  test("GATE B: deriveNextAction still runs the hard product guard on the final answer", () => {
    const fn = sliceBetween("export function deriveNextAction", "\n    return {");
    assert.match(fn, /guardFundingProduct\(\s*chosen\s*,/,
      "the hard product guard is no longer called on the chosen action. GATE B is " +
      "Chris's other non-negotiable: a repair-only client never sees a funding chip.");
  });

  test("both hard guards are still exported, so neither can be quietly inlined away", () => {
    assert.equal(typeof guardConsentBeforePull, "function");
    assert.equal(typeof guardFundingProduct, "function");
  });
});

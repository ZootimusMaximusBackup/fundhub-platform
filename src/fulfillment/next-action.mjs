/* Fulfillment — what is this client's next action.
 *
 * READ AND DECIDE ONLY. Nothing here writes, queries, fetches, or imports a
 * module that opens a connection. It takes a plain object of signals the read
 * layer has already gathered and returns a plain object. The read layer
 * gathers; this decides. That split is what lets the queue screen, the client
 * control panel and the client list all show the SAME answer without three
 * copies of the rule drifting apart.
 *
 * Phase 0 mapping and the file:line evidence for every signal:
 *   docs/workflows/fulfillment-layer-2026-08-19.md
 *
 *
 * THE ORDER IS CHRIS'S, AND IT IS FIRST-MATCH-WINS.
 *
 * NEXT_ACTIONS below is the whole order. The first chip that says YES is the
 * answer; nothing below it is consulted. Chris set this order — it is not
 * derived from anything in the code, and Phase 0 §4 says so plainly.
 *
 *
 * TWO COMPLIANCE GATES, EACH BUILT TWICE.
 *
 *   GATE A — a client with NO recorded consent NEVER sees "Pull CRS".
 *   GATE B — a repair-only client NEVER sees a funding chip.
 *
 * Each is built as an ORDERING RULE (the chip's own predicate, plus its rank)
 * and again as a HARD GUARD (guardConsentBeforePull / guardFundingProduct)
 * that runs on the final answer and knows nothing about NEXT_ACTIONS. Reorder
 * the list, delete a predicate, rename a rank — the guard still refuses. The
 * two layers are independently observable so a test can fail on either one
 * being removed:
 *
 *   * the ORDERING RULE produces the USEFUL answer ("Get Consent");
 *   * the HARD GUARD produces the SAFE answer (null + degraded:true, which
 *     sends the screen back to today's display).
 *
 * If a guard ever fires, the ordering above it is broken. That is why a guard
 * firing degrades the whole answer rather than quietly substituting a
 * different chip: a wrong order is not something to paper over.
 *
 *
 * HONEST DEGRADE — the point of this whole module.
 *
 * Missing data never produces a blank and never throws. It produces a truthful
 * lesser answer. Three rules:
 *
 *   1. A chip is UNKNOWN when a signal it needs to say NO is missing, and
 *      ALSO when the thing it needs to say YES is an ABSENCE — an empty list
 *      we never managed to read looks exactly like an empty list. A chip that
 *      needs positive evidence to say YES is NO when that evidence is absent:
 *      absence is not evidence.
 *   2. An UNKNOWN reached before any YES stops the walk: under first-match-
 *      wins we cannot claim a lower chip is the answer when a higher one
 *      could not be read. That sets degraded:true and next_action:null.
 *   3. NULL money stays NULL. A demo credit row is not a real pull.
 *
 * FIVE chips can answer UNKNOWN, and each one says so in its own comment:
 *
 *   "Clear Fraud Alert" and "Collect Documents" — the tags were not read.
 *   "Get Consent" and "Pull CRS" — the consent verdict or the credit evidence
 *      was not gathered. Both are consumer-credit decisions, so "we did not
 *      look" must never read as "no".
 *   "Ready to Fund" — the blocker list was not read. This one is rule 1's
 *      second half: the chip fires on there being NO blockers, so a list that
 *      failed to load would otherwise read as a file with nothing wrong.
 */

import { isFundingPath, isRepairOnlyPath } from "../config/product-path.mjs";

/* ────────────────────────────────────────────────────────────────────────────
   THE ORDER. Chris's ten, in Chris's words, first match wins.

   `key`       snake_case, stable, safe in a URL or a CSS class.
   `label`     Chris's exact display words. Do not reword these.
   `isFunding` the four chips GATE B blocks for a repair-only client.

   "Lock Fee" is deliberately absent — it is a money-side signal, not a queue
   chip. "File Prep" is deliberately absent — dropped, nothing backs it.
   ──────────────────────────────────────────────────────────────────────────── */
export const NEXT_ACTIONS = Object.freeze([
  Object.freeze({ key: "clear_fraud_alert",   label: "Clear Fraud Alert",   isFunding: false }),
  Object.freeze({ key: "get_consent",         label: "Get Consent",         isFunding: false }),
  Object.freeze({ key: "pull_crs",            label: "Pull CRS",            isFunding: false }),
  Object.freeze({ key: "remove_inquiries",    label: "Remove Inquiries",    isFunding: false }),
  Object.freeze({ key: "collect_documents",   label: "Collect Documents",   isFunding: false }),
  Object.freeze({ key: "review_disputes",     label: "Review Disputes",     isFunding: false }),
  Object.freeze({ key: "review_funding_file", label: "Review Funding File", isFunding: true }),
  Object.freeze({ key: "prepare_next_round",  label: "Prepare Next Round",  isFunding: true }),
  Object.freeze({ key: "apply_for_funding",   label: "Apply for Funding",   isFunding: true }),
  Object.freeze({ key: "ready_to_fund",       label: "Ready to Fund",       isFunding: true })
]);

/* The four funding chips, written out a SECOND time on purpose.
   guardFundingProduct() reads this and never reads NEXT_ACTIONS, so GATE B
   survives the whole ordered list being rewritten. next-action.test.mjs fails
   if the two lists ever disagree. */
export const FUNDING_CHIP_KEYS = Object.freeze([
  "review_funding_file",
  "prepare_next_round",
  "apply_for_funding",
  "ready_to_fund"
]);

/* Inquiry-removal case states that count as "still being worked".
   Copied from src/inquiry-ops/gate.mjs:8 (`ACTIVE`). Copied rather than
   imported because gate.mjs pulls in ../workflows/cards.mjs and
   ../lib/create-task.mjs, and this module must not import anything that can
   reach a database handle. If gate.mjs's list changes, change this one. */
const ACTIVE_INQUIRY_STATES = Object.freeze([
  "Queued", "Scheduled", "In Progress", "Escalated", "Blocked"
]);

/* A funding round that has reached the end of its life.
   Same two strings src/funding/card-stacking-rounds.mjs:219 treats as
   terminal when it decides whether to reuse a round number or allocate N+1. */
const TERMINAL_ROUND_STATUSES = Object.freeze(["funded", "closed"]);

/* Why a consent is not usable. Mirrors CONSENT_REASONS in
   src/consent/index.mjs. NOT imported: that module imports ../db.mjs and
   would open a connection pool the moment this file loaded. */
const CONSENT_REASON_WORDS = Object.freeze({
  revoked: "They took their written permission back, so we need fresh permission before we can touch their credit.",
  expired: "Their written permission has run out, so we need fresh permission before we can touch their credit.",
  not_yet_effective: "Their written permission has not started yet, so we cannot touch their credit today.",
  none_on_file: "We do not have their written permission on file, so we cannot pull their credit yet."
});
const CONSENT_REASON_FALLBACK = CONSENT_REASON_WORDS.none_on_file;

const FRAUD_TAG = "fraud:alert-present";
const DOCS_MISSING_TAG = "docs:missing";
const FRAUD_HOLD_REASON = "Fraud Alert";
const CRS_COMPLETE = "Complete";
const PRE_FUNDING_REVIEW_WORKFLOW = "c-05-pre-funding-review";
const CARD_STACKING_PIPELINE = "funding_card_stacking";
const CARD_STACKING_APPROVED_STAGE = "approved";
const CARD_STACKING_APPLY_NOW_STAGE = "apply_now";

/* ── tiny readers. Every one of them answers "I cannot tell" as null. ──────── */

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Trimmed string, or null. Blank is null — a whitespace value says nothing. */
function str(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** Finite number, or null. Handles pg numeric, which arrives as a string.
 *  null/undefined/"" stay null — they mean UNKNOWN and must never become 0. */
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function toDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function rowsOf(v) {
  return Array.isArray(v) ? v.filter(isPlainObject) : [];
}

/* ── verdicts ─────────────────────────────────────────────────────────────── */

const YES = (why) => ({ verdict: "yes", why });
const NO = () => ({ verdict: "no", why: null });
const UNKNOWN = () => ({ verdict: "unknown", why: null });

/* ── the context the evaluators read ──────────────────────────────────────── */

function buildContext(signals) {
  const cfRaw = signals.custom_fields;
  const tagsRaw = signals.tags;

  /* custom_fields and tags are one row on the client and are always available
     to a read layer. Absent or the wrong type means we could not read them,
     which is why they are null here rather than {} / [] — a default would turn
     "we did not look" into "there is nothing there". */
  const cf = isPlainObject(cfRaw) ? cfRaw : null;
  const tags = Array.isArray(tagsRaw) ? tagsRaw.map((t) => str(t)).filter(Boolean) : null;

  /* CONSENT. Pass the object src/consent/index.mjs consentStatus() returns,
     for kind "soft_pull_consent" — the SAME call the pull endpoint's gate
     makes at src/finance/soft-pulls.mjs:306-314. Reading the same source is
     what stops the screen and the button disagreeing.
     Anything that is not that shape is "we did not ask", not "no". */
  const consentRaw = signals.consent;
  const consentKnown = isPlainObject(consentRaw) && typeof consentRaw.valid === "boolean";
  const consentValid = consentKnown ? consentRaw.valid : null;
  const consentReason = consentKnown ? str(consentRaw.reason) : null;

  /* REAL CREDIT PULLS. crs_results carries is_demo
     (db/migrations/148_demo_mode.sql:20) and a demo row is not a real pull.
     Prefer handing over the rows and letting this count them. A count is
     accepted for list screens that will not ship every row — but a count you
     pass MUST already exclude is_demo. Do NOT reuse crs_count from
     api/dashboard/clients.mjs:33; Phase 0 found it has no is_demo filter. */
  let realCrsCount = null;
  if (Array.isArray(signals.crs_results)) {
    realCrsCount = rowsOf(signals.crs_results).filter((r) => r.is_demo !== true).length;
  } else {
    const counted = num(signals.real_crs_result_count);
    if (counted !== null) realCrsCount = counted;
  }

  const inquiryCases = rowsOf(signals.inquiry_cases);
  const docPacket = isPlainObject(signals.doc_packet) ? signals.doc_packet : null;
  const disputeResponses = rowsOf(signals.dispute_responses);
  const disputeCases = rowsOf(signals.dispute_cases);
  const tasks = rowsOf(signals.tasks);
  const rounds = rowsOf(signals.funding_rounds);
  const card = isPlainObject(signals.card) ? signals.card : null;
  const now = toDate(signals.now) || new Date();

  const tier = str(signals.outcome_tier);

  const ctx = {
    cf, tags, tier,
    // consentValid: true / false / null, where null means "nobody asked".
    consentValid, consentReason,
    realCrsCount,
    inquiryCases, docPacket, disputeResponses, disputeCases, tasks, rounds, card,
    now
  };

  /* THE BLOCKER LIST COULD NOT BE READ. The read layer sets this when any of
     the three reads openBlockers() needs refused (read-signals.mjs). It is not
     the same thing as an empty list: empty means we looked and nothing is
     stopping the file, and that is exactly what "Ready to Fund" is built on. */
  ctx.blockersUnknown = signals.blockers_unknown === true;

  ctx.crsComplete = cf === null ? null : str(cf.crs_status) === CRS_COMPLETE;
  ctx.fraud = evaluateFraud(ctx);
  ctx.blockers = buildBlockers(signals, ctx);
  ctx.round = summariseRound(ctx.rounds);
  return ctx;
}

/* ── GATE B, the ordering half ────────────────────────────────────────────────
   A funding chip may only be offered when the product type is KNOWN and is one
   of the three funding tiers (src/config/product-path.mjs). That refuses
   REPAIR_ONLY by name and refuses an unknown or missing tier by failing
   closed, which is the posture product-path.mjs's own header sets out. The
   hard half of this gate is guardFundingProduct() below.

   deriveNextAction() also asks this before it hands back a funding_round, so
   the approved amount on that round is refused on exactly the same tiers the
   chips are. One whitelist, one function, both answers. */
function fundingChipsAllowed(ctx) {
  if (isRepairOnlyPath(ctx.tier)) return false;
  return isFundingPath(ctx.tier);
}

/** True when a real (non-demo) credit pull is already in. null when we cannot
 *  tell — nobody handed over the credit evidence, and "we did not look" is not
 *  the same answer as "there is nothing there". */
function completedCreditPull(ctx) {
  if (ctx.crsComplete === true) return true;
  if (ctx.realCrsCount === null) return null;
  return ctx.realCrsCount > 0;
}

/* ── the ten evaluators ───────────────────────────────────────────────────── */

/* 1. CLEAR FRAUD ALERT.
   Three sources, any one of them (Phase 0 §3 row 1):
     - tag fraud:alert-present     src/workflows/c-03-…:38
     - custom_fields.round_hold_reason = "Fraud Alert"   c-03:37
     - the inquiry case carries a fraud note
       inquiry_removal_cases.fraud_alert_after, db/migrations/140_inquiry_ops.sql:116
   NOTHING IN THIS SYSTEM EVER CLEARS IT. Phase 0 grepped for a clear path and
   found none: no removeTags of the tag, fraud_alert_after is never written,
   and both mirror columns are dead. The `why` says so out loud so the screen
   can say so too. */
function evaluateFraud(ctx) {
  const note = ctx.inquiryCases.some((c) => str(c.fraud_alert_after) !== null);
  if (note) {
    return YES("A fraud alert is recorded on their inquiry case, and nothing in this system ever takes it off — a person has to clear it by hand.");
  }
  if (ctx.tags !== null && ctx.tags.includes(FRAUD_TAG)) {
    return YES("A fraud alert is on their credit file, and nothing in this system ever takes it off — a person has to clear it by hand.");
  }
  if (ctx.cf !== null && str(ctx.cf.round_hold_reason) === FRAUD_HOLD_REASON) {
    return YES("Their funding round is on hold for a fraud alert, and nothing in this system ever takes that hold off — a person has to clear it by hand.");
  }
  // To say NO we need to have read BOTH the tags and the hold reason.
  if (ctx.tags === null || ctx.cf === null) return UNKNOWN();
  return NO();
}

/* 2. GET CONSENT — GATE A, the ordering half.
   Fires when there is no usable soft-pull consent AND no completed credit pull
   already exists. A client whose credit is already in is not blocked on
   consent. Ranked ABOVE "Pull CRS", so first-match-wins means a client with no
   consent can never be told to pull. The hard half is
   guardConsentBeforePull(). */
function evaluateGetConsent(ctx) {
  const pulled = completedCreditPull(ctx);
  if (pulled === true) return NO();
  if (ctx.consentValid === true) return NO();
  if (ctx.consentValid === false) {
    if (pulled === null) return UNKNOWN();   // no consent, but we cannot tell if credit is already in
    const words = CONSENT_REASON_WORDS[ctx.consentReason] || CONSENT_REASON_FALLBACK;
    return YES(words);
  }
  return UNKNOWN();                           // consent was never gathered — never read that as "no"
}

/* 3. PULL CRS.
   Paid for the report, no REAL result on file, and credit status is not
   Complete. A demo crs_results row does not count (148_demo_mode.sql:20).
   GATE A also refuses this chip outright in guardConsentBeforePull(). */
function evaluatePullCrs(ctx) {
  if (ctx.cf === null) return UNKNOWN();
  if (ctx.cf.crs_paid !== true) return NO();
  if (ctx.crsComplete === true) return NO();
  if (ctx.realCrsCount === null) return UNKNOWN();
  if (ctx.realCrsCount > 0) return NO();
  // Belt for GATE A at the predicate: never offer the pull without consent.
  if (ctx.consentValid !== true) return NO();
  return YES("They paid for their credit report and we have not pulled it yet.");
}

/* 4. REMOVE INQUIRIES.
   An inquiry_removal_cases row in any active state — src/inquiry-ops/gate.mjs:8. */
function evaluateRemoveInquiries(ctx) {
  const open = ctx.inquiryCases.filter((c) => ACTIVE_INQUIRY_STATES.includes(str(c.case_status)));
  if (open.length === 0) return NO();
  return YES("They have credit inquiries we are still working to get taken off.");
}

/* 5. COLLECT DOCUMENTS.
   Tag docs:missing (f-02:42, f-06:46), OR the inquiry case is Blocked and the
   identity packet comes back short (src/inquiry-ops/doc-gate.mjs). */
function evaluateCollectDocuments(ctx) {
  if (ctx.tags !== null && ctx.tags.includes(DOCS_MISSING_TAG)) {
    return YES("We are waiting on paperwork from them.");
  }
  const blocked = ctx.inquiryCases.some((c) => str(c.case_status) === "Blocked");
  if (blocked && ctx.docPacket && ctx.docPacket.complete === false) {
    const missing = Array.isArray(ctx.docPacket.missing) ? ctx.docPacket.missing.length : 0;
    return YES(missing > 0
      ? `Their inquiry case is stuck and ${missing} identity document${missing === 1 ? "" : "s"} are still missing.`
      : "Their inquiry case is stuck because their identity paperwork is not complete.");
  }
  if (ctx.tags === null) return UNKNOWN();
  return NO();
}

/* 6. REVIEW DISPUTES.
   A dispute_responses row nobody has confirmed, OR a dispute_cases row sitting
   at awaiting_response past its response_due_at
   (db/migrations/160_metro2_dispute_engine.sql:30, :76). */
function evaluateReviewDisputes(ctx) {
  const unread = ctx.disputeResponses.filter((r) => r.confirmed !== true).length;
  if (unread > 0) {
    return YES(unread === 1
      ? "A credit bureau answered and nobody has read the answer yet."
      : `${unread} credit bureau answers are sitting unread.`);
  }
  const overdue = ctx.disputeCases.filter((c) => {
    if (str(c.status) !== "awaiting_response") return false;
    const due = toDate(c.response_due_at);
    return due !== null && due.getTime() < ctx.now.getTime();
  }).length;
  if (overdue > 0) {
    return YES(overdue === 1
      ? "A dispute is past the date the bureau was due to answer."
      : `${overdue} disputes are past the date the bureaus were due to answer.`);
  }
  return NO();
}

/* 7. REVIEW FUNDING FILE — a funding chip, GATE B applies.
   Credit status Complete AND an open review task raised by
   src/workflows/c-05-pre-funding-review.mjs. That workflow also raises
   "Cannot start funding — CRS incomplete" under the same source_workflow; the
   Complete check above is what separates the two. */
function evaluateReviewFundingFile(ctx) {
  if (!fundingChipsAllowed(ctx)) return NO();
  if (ctx.crsComplete !== true) return NO();
  const open = ctx.tasks.some(
    (t) => str(t.source_workflow) === PRE_FUNDING_REVIEW_WORKFLOW && t.done !== true
  );
  if (!open) return NO();
  return YES("Their credit report is in and someone still has to read it before we send applications.");
}

/* 8. PREPARE NEXT ROUND — a funding chip, GATE B applies.
   The funding card sits on the approved stage (db/seed/002_pipelines.sql:35),
   OR the newest funding round has an approved amount above zero.
   A NULL approved_amount is UNKNOWN and does not fire this. */
function evaluatePrepareNextRound(ctx) {
  if (!fundingChipsAllowed(ctx)) return NO();
  if (ctx.card
      && str(ctx.card.pipeline_key) === CARD_STACKING_PIPELINE
      && str(ctx.card.stage_key) === CARD_STACKING_APPROVED_STAGE) {
    return YES("Their funding card is sitting on Approved, so the next round needs getting ready.");
  }
  const approved = ctx.round ? num(ctx.round.approved_amount) : null;
  if (approved !== null && approved > 0) {
    return YES("A bank said yes on their newest round, so the next round needs getting ready.");
  }
  return NO();
}

/* 9. APPLY FOR FUNDING — a funding chip, GATE B applies.
   The funding card sits on Apply Now (staff MOVE), OR
   custom_fields.ready_for_next_round true (c-03:45) AND the outcome tier is a
   funding tier. The tier check is not optional — leaving it out is Phase 0
   defect 1, live today: a repair-only client being told to apply.
   A card already on Apply Now is handled first in deriveNextAction so that
   job is not hidden by an earlier chip. */
function evaluateApplyForFunding(ctx) {
  if (!fundingChipsAllowed(ctx)) return NO();
  if (cardOnApplyNow(ctx)) {
    return YES("Their funding card is sitting on Apply Now, so it is time to apply.");
  }
  if (ctx.cf === null) return NO();
  if (ctx.cf.ready_for_next_round !== true) return NO();
  return YES("Their file is clean and their plan includes funding, so it is time to apply.");
}

function cardOnApplyNow(ctx) {
  return !!(ctx.card
    && str(ctx.card.pipeline_key) === CARD_STACKING_PIPELINE
    && str(ctx.card.stage_key) === CARD_STACKING_APPLY_NOW_STAGE);
}

/* 10. READY TO FUND — a funding chip, GATE B applies.
   The lead's addition, ranked last, and flagged to Chris. Nothing in the
   system writes this status; it is derived: no active blockers, the newest
   round is not on hold, and the document packet is complete.
   Every part needs positive evidence, so a missing packet is NO, not YES. */
function evaluateReadyToFund(ctx) {
  if (!fundingChipsAllowed(ctx)) return NO();
  /* GATE B FIRST, ON PURPOSE: a repair-only client never reaches this line, so
     an unreadable blocker list never degrades a file that has no funding step
     to lose. Then the honest degrade: this chip's whole test is "the blocker
     list is empty", so a list that could not be read is UNKNOWN — never a
     quiet zero that reads as "nothing is stopping this file". */
  if (ctx.blockersUnknown) return UNKNOWN();
  if (ctx.blockers.length > 0) return NO();
  if (ctx.round && str(ctx.round.hold_reason) !== null) return NO();
  if (!ctx.docPacket || ctx.docPacket.complete !== true) return NO();
  return YES("Nothing is blocking this file, their round is not on hold, and their paperwork is complete.");
}

const EVALUATORS = Object.freeze({
  clear_fraud_alert: (ctx) => ctx.fraud,
  get_consent: evaluateGetConsent,
  pull_crs: evaluatePullCrs,
  remove_inquiries: evaluateRemoveInquiries,
  collect_documents: evaluateCollectDocuments,
  review_disputes: evaluateReviewDisputes,
  review_funding_file: evaluateReviewFundingFile,
  prepare_next_round: evaluatePrepareNextRound,
  apply_for_funding: evaluateApplyForFunding,
  ready_to_fund: evaluateReadyToFund
});

/* ── blockers ─────────────────────────────────────────────────────────────────
   REUSED, NOT REBUILT. openBlockers() at src/http/client-detail.mjs:169-215 is
   already severity-ranked and already painted on the client control panel. The
   read layer calls it and hands the result over as `open_blockers`; this
   normalises each row to carry a `key` and keeps every field it already had.

   It covers: open tasks, a funding round with a hold_reason, an invoice with a
   balance due, custom_fields.crs_paid === false, and the deposit gate.

   TWO ARE ADDED HERE because openBlockers has no way to see them and both are
   compliance stops:
     * fraud_alert    — openBlockers only sees the fraud TASK. Mark that task
                        done and the alert becomes invisible, yet nothing ever
                        clears the alert itself.
     * consent_missing / consent_unknown — openBlockers does not read consent
                        at all. Which of the two is added says whether we
                        checked and found none, or could not check.
   Nothing else is added. Active inquiries, unread disputes and a short
   document packet are each already their own chip, and in practice each also
   carries an open task that openBlockers surfaces; adding them here would
   double-count against the same row.

   ONE LABEL IS REWRITTEN — GATE A, ON THE BLOCKER LIST.
   The rewrite itself lives in sanitizeBlockerLabels() below, because the read
   layer has to run the SAME rewrite on the raw array it emits. Read that
   function's header for the rule and for the defect that moved it there. */
const PULL_CREDIT_TASK_SOURCES = Object.freeze(["s-06-post-call-funding-purchased"]);

/* TWO LABELS, BECAUSE THERE ARE TWO DIFFERENT TRUTHS.

     consent KNOWN BAD (=== false) — we looked, and there is no live written
       permission. "Waiting on written permission" is a fact.
     consent UNKNOWN (=== null)    — the permission record could not be read.
       We did not look. Saying "waiting on written permission" here asserts
       something nobody verified, so it says what actually happened instead.

   Both refuse the pull. Only the words differ. */
const PULL_BLOCKED_LABEL   = "Funding intake — waiting on written permission";
const PULL_UNCHECKED_LABEL = "Funding intake — we could not check written permission";

/* A row so broken we could not read its own source. Never seen in practice —
   these rows are built by openBlockers() from our own queries — but a row we
   cannot read is a row we cannot clear, so it keeps its place in the list
   without any of its own words. */
const BLOCKER_UNREADABLE = "Something is blocking this file and we could not read what it is";

function pullBlockedLabel(consentValid) {
  return consentValid === false ? PULL_BLOCKED_LABEL : PULL_UNCHECKED_LABEL;
}

/* THE BACKSTOP, AND WHY IT EXISTS DESPITE THE SOURCE MATCH.

   Matching on the workflow id is precise and cannot rewrite a title somebody
   typed by hand, and today it is also complete — s-06 is the only workflow in
   the tree that raises a pull-credit task. But openBlockers() falls back to the
   literal "task" when tasks.source_workflow is NULL, so a pull-credit task
   raised any other way (an import, a hand-made row, a workflow added later)
   carries its raw title straight to the screen. An adversary demonstrated
   exactly that in a browser.

   Chris called Gate A non-negotiable, so completeness beats precision here.
   This is a SECOND test, not a replacement. It only runs when the source match
   did not fire AND written permission is not established — when permission IS
   on file sanitizeBlockerLabels has already returned, so a real title is never
   touched. The original words always survive on recorded_label. */
const PULL_CREDIT_WORDS =
  /\bpull(?:ing|ed|s)?\b[^.]{0,40}\b(?:crs|credit|bureau|tri[-\s]?merge|equifax|experian|transunion)\b|\b(?:crs|credit|bureau|tri[-\s]?merge|equifax|experian|transunion)\b[^.]{0,40}\bpull(?:ing|ed|s)?\b/i;

function looksLikePullCreditTask(b) {
  try {
    const words = str(b.recorded_label) || str(b.label) || "";
    return PULL_CREDIT_WORDS.test(words);
  } catch {
    // A row whose own label cannot be read is a row we cannot clear as safe.
    return true;
  }
}

/**
 * sanitizeBlockerLabels — GATE A on the blocker list, in ONE place.
 *
 * THE DEFECT THIS CLOSES. This rewrite used to live inside buildBlockers(), so
 * only `active_blockers` came out safe. GET /api/dashboard/client ALSO returns
 * the raw `open_blockers` array, and the client control panel paints that array
 * directly in two more spots — the pre-existing Blockers panel, and the new
 * control block's fallback when no derivation arrives. On a real client with no
 * recorded permission the top panel read "Funding intake — pull CRS" while the
 * block below it read "waiting on written permission": two panels, one screen,
 * contradicting each other. Patching it panel by panel failed three times.
 * The read layer now runs THIS function on the array it emits, so every
 * consumer — both panels, the pipeline lens, and anything built later — gets
 * the safe label without having to know it should ask.
 *
 * RELABEL, NEVER HIDE. The blocker keeps its id, kind, detail, severity and
 * source. Only the words change, and the original rides along as
 * `recorded_label` — what is on the record, never an instruction.
 *
 * TWO TESTS, EITHER ONE IS ENOUGH. First the workflow id: every blocker
 * openBlockers() builds from a task carries `source: t.source_workflow`, and
 * exactly one workflow (src/workflows/s-06-post-call-funding-purchased.mjs:25)
 * raises a task titled "Funding intake — pull CRS". Second the words, via
 * PULL_CREDIT_WORDS above — because `source` falls back to the literal "task"
 * when tasks.source_workflow is NULL, and an adversary showed a pull-credit
 * task raised any other way reaching the screen raw. The words test only runs
 * when permission is NOT established, so a real title is never rewritten while
 * the pull is allowed. IF ANOTHER WORKFLOW RAISES A PULL-CREDIT TASK, STILL ADD
 * ITS ID TO PULL_CREDIT_TASK_SOURCES ABOVE — the id is the precise test and the
 * words are only the safety net.
 *
 * FAILS CLOSED — anything but consentValid === true relabels, including "the
 * read failed", the same posture guardConsentBeforePull() takes on the chip.
 * IDEMPOTENT — a second pass cannot overwrite the words already captured on
 * `recorded_label`, so the read layer and the derivation may both run it over
 * the same array.
 * NEVER THROWS, and never drops a row.
 *
 * @param {unknown} blockers    rows as openBlockers() built them
 * @param {{consentValid?: boolean|null}} opts
 * @returns {Array} a new array; rows that needed no change are the same objects
 */
export function sanitizeBlockerLabels(blockers, { consentValid } = {}) {
  const rows = Array.isArray(blockers) ? blockers : [];
  // Known live permission: there is nothing to keep from anyone, and the real
  // titles pass through byte for byte.
  if (consentValid === true) return rows.slice();

  const out = [];
  for (const b of rows) {
    try {
      if (!isPlainObject(b)) {
        out.push(b);
        continue;
      }
      // Two tests, either one is enough: the workflow id we know raises one,
      // or the words themselves. See PULL_CREDIT_WORDS for why both.
      const isPullCredit =
        PULL_CREDIT_TASK_SOURCES.includes(str(b.source)) || looksLikePullCreditTask(b);
      if (!isPullCredit) {
        out.push(b);
        continue;
      }
      // Second pass: keep the words on the record from the FIRST pass. Without
      // this, running twice would record our own safe label as "the original".
      const recorded = "recorded_label" in b ? b.recorded_label : b.label;
      out.push({ ...b, recorded_label: recorded, label: pullBlockedLabel(consentValid) });
    } catch {
      out.push({ key: "blocker", label: BLOCKER_UNREADABLE, severity: "high" });
    }
  }
  return out;
}

function buildBlockers(signals, ctx) {
  const normalised = [];

  for (const b of rowsOf(signals.open_blockers)) {
    const key = str(b.key) || str(b.kind);
    const label = str(b.label);
    if (!key && !label) continue;
    normalised.push({
      ...b,
      key: key || "blocker",
      label: label || key,
      severity: str(b.severity) === "high" ? "high" : "normal"
    });
  }

  /* GATE A, the SAME function the read layer runs on the array it emits.
     Idempotent, so running it here after the read layer has already run it
     cannot overwrite the words on the record. */
  const out = sanitizeBlockerLabels(normalised, { consentValid: ctx.consentValid });

  if (ctx.fraud.verdict === "yes") {
    out.push({
      key: "fraud_alert",
      label: "Fraud alert on file",
      severity: "high",
      detail: "Nothing in this system ever clears a fraud alert — a person has to.",
      source: "clients.tags / custom_fields.round_hold_reason / inquiry_removal_cases.fraud_alert_after"
    });
  }

  /* WHY THE PULL IS REFUSED — split in two on purpose.

     === false is "we checked, and there is no live written permission".
     === null is "the permission record could not be read", which is a
     different sentence and used to be told as the first one: the relabel above
     fired on anything that was not a live consent, while this explanation only
     fired on a known-bad one. So a failed consent read put "waiting on written
     permission" on screen with nothing underneath saying we never checked.
     Adversary finding, 2026-08-19. Now both cases say what actually happened. */
  if (ctx.consentValid === false) {
    out.push({
      key: "consent_missing",
      label: "No written permission on file",
      severity: "high",
      detail: CONSENT_REASON_WORDS[ctx.consentReason] || CONSENT_REASON_FALLBACK,
      source: "client_consents (soft_pull_consent)"
    });
  } else if (ctx.consentValid === null) {
    out.push({
      key: "consent_unknown",
      label: "We could not check written permission",
      severity: "high",
      detail: "Their written permission record could not be read, so we do not know " +
              "whether they gave it. Nobody should touch this client's credit until a " +
              "person checks.",
      source: "client_consents (soft_pull_consent)"
    });
  }

  const rank = { high: 0, normal: 1 };
  return out
    .map((b, i) => ({ b, i }))
    .sort((x, y) => (rank[x.b.severity] - rank[y.b.severity]) || (x.i - y.i))
    .map((x) => x.b);
}

/* ── the newest round ─────────────────────────────────────────────────────────
   Rows are expected newest-first, the same order the client control panel
   already assumes (public/app/client-control-panel.html:878). When every row
   carries a round_number the highest wins, because that is what the number
   means and it does not depend on the caller's ORDER BY.

   approved_amount is passed through EXACTLY as it arrived. It is
   numeric(14,2), so pg hands it over as a string, and NULL means "nobody has
   recorded an approval" — it must survive as null and must never become 0.

   is_demo is NOT filtered here. The read layer decides which rounds count,
   the same way it decides demo policy for the rest of the screen. */
function summariseRound(rounds) {
  if (rounds.length === 0) return null;
  let best = rounds[0];
  for (const r of rounds) {
    const a = num(r.round_number);
    const b = num(best.round_number);
    if (a !== null && b !== null && a > b) best = r;
  }
  const status = str(best.status);
  return {
    number: num(best.round_number),
    status,
    hold_reason: str(best.hold_reason),
    approved_amount: best.approved_amount === undefined ? null : best.approved_amount,
    finalized: status === null ? null : TERMINAL_ROUND_STATUSES.includes(status.toLowerCase())
  };
}

/* ── GATE A, the hard half ────────────────────────────────────────────────────
   Refuses "Pull CRS" unless consent is KNOWN VALID. Missing, revoked, expired,
   not-yet-effective and never-gathered are all refusals — this function has no
   branch that lets the pull through on anything but a live consent, which is
   the same fail-closed posture src/consent/index.mjs takes.

   It knows nothing about NEXT_ACTIONS, so reordering the list cannot defeat it.
   Returns the action unchanged when it is allowed, or null when it is refused.
   deriveNextAction() turns a refusal into degraded:true and next_action:null. */
export function guardConsentBeforePull(action, { consentValid } = {}) {
  if (!isPlainObject(action)) return null;
  if (action.key !== "pull_crs") return action;
  if (consentValid === true) return action;
  return null;
}

/* ── GATE B, the hard half ────────────────────────────────────────────────────
   Refuses any funding chip unless the outcome tier is one of the three funding
   tiers. REPAIR_ONLY is refused by name; an unknown, missing or unrecognised
   tier is refused by failing closed, exactly as src/config/product-path.mjs
   requires. Reads FUNDING_CHIP_KEYS, never NEXT_ACTIONS. */
export function guardFundingProduct(action, { outcomeTier } = {}) {
  if (!isPlainObject(action)) return null;
  if (!FUNDING_CHIP_KEYS.includes(action.key)) return action;
  if (isRepairOnlyPath(outcomeTier)) return null;
  if (!isFundingPath(outcomeTier)) return null;
  return action;
}

/* ── the answer ───────────────────────────────────────────────────────────── */

const FALLBACK = () => ({
  next_action: null,
  active_blockers: [],
  funding_round: null,
  degraded: true
});

/**
 * deriveNextAction — what should someone do about this client next.
 *
 * PURE. Never throws. Any unexpected shape returns the fallback with
 * degraded:true, which tells the screen to fall back to today's display
 * rather than paint a blank.
 *
 * @param {object} signals  see buildContext() above for every key it reads.
 * @returns {{
 *   next_action: { key: string, label: string, why: string } | null,
 *   active_blockers: Array<{ key: string, label: string, severity: string }>,
 *   funding_round: { number: number|null, status: string|null, hold_reason: string|null,
 *                    approved_amount: unknown, finalized: boolean|null } | null,
 *                  — null on any tier that is not one of the three funding
 *                    tiers, including REPAIR_ONLY. Gate B, see below.
 *   degraded: boolean
 * }}
 */
export function deriveNextAction(signals) {
  try {
    if (!isPlainObject(signals)) return FALLBACK();

    const ctx = buildContext(signals);

    let degraded = false;
    let chosen = null;

    // Staff parked the card on Apply Now — applying is the job. Repair-only
    // still refuses. A missing product tier does not hide that job.
    const applyNowJob = cardOnApplyNow(ctx) && !isRepairOnlyPath(ctx.tier);
    if (applyNowJob) {
      chosen = {
        key: "apply_for_funding",
        label: "Apply for Funding",
        why: "Their funding card is sitting on Apply Now, so it is time to apply."
      };
    } else {
      for (const spec of NEXT_ACTIONS) {
        const evaluator = EVALUATORS[spec.key];
        if (!evaluator) continue;
        const v = evaluator(ctx);
        if (!v || v.verdict === "unknown") { degraded = true; break; }
        if (v.verdict === "yes") {
          chosen = { key: spec.key, label: spec.label, why: v.why };
          break;
        }
      }
    }

    // The hard halves of both gates, on the final answer. A guard firing means
    // the ordering above it is broken, so the answer is dropped and the screen
    // falls back — never quietly swapped for a different chip.
    if (chosen && guardConsentBeforePull(chosen, { consentValid: ctx.consentValid }) !== chosen) {
      chosen = null;
      degraded = true;
    }
    if (chosen && !applyNowJob && guardFundingProduct(chosen, { outcomeTier: ctx.tier }) !== chosen) {
      chosen = null;
      degraded = true;
    }

    /* GATE B, applied to the MONEY as well as to the chip.
       A funding round carries an approved amount, and an approved amount is
       funding-shaped money. Handing one back for a REPAIR_ONLY client puts
       "approved $75,000" on a file that never bought funding — no chip is
       involved, so guardFundingProduct() above never sees it, but a reader
       cannot tell the difference. Same whitelist, same helper, same three
       tiers: fundingChipsAllowed() reads src/config/product-path.mjs and fails
       closed on REPAIR_ONLY, on an unknown tier and on no tier at all.
       Both screens read this key and only this key for the round they paint,
       so null here is nothing shown there. `degraded` is untouched: refusing
       to show funding money to a repair client is the right answer, not a
       failure to work one out. */
    return {
      next_action: chosen,
      active_blockers: ctx.blockers,
      funding_round: fundingChipsAllowed(ctx) ? ctx.round : null,
      degraded
    };
  } catch {
    return FALLBACK();
  }
}

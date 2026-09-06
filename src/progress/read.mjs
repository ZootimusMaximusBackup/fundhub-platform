// readClientProgress — every fact the client progress page needs, in one read.
//
// BUILT TO A WRITTEN CONTRACT. The orchestrator wrote the JSON shape before
// either side existed so the endpoint and the screen could be built at the same
// time. Where this file could not honour a field exactly it says so in a
// comment beginning DEVIATION and the branch's report repeats it; it does not
// quietly return something else, because a second lane is coding against the
// same document.
//
// MOSTLY FACTS, AND HERE IS EXACTLY WHERE IT IS NOT.
//
// The aim is api/read/portal-summary.mjs:20's rule — numbers, booleans, dates,
// identifiers and enums, with the words a client reads living in the front end.
// This endpoint does NOT fully reach it, and an earlier version of this comment
// claimed it did. It does not, in six places, and every one of them is English a
// client can read:
//
//   timeline[].text          chosen from the allowlist in ./timeline.mjs
//   stage.roundLabel         roundLadderEntry().title, e.g. "Round 2 FCRA /
//                            method of verification"
//   paidServices[].components[].label   from src/waypoints/pricing.mjs
//   waypoints[].title        stored on the waypoint row
//   waypoints[].paidAlternative.label   stored on the waypoint row
//   scores.business[].name   the business's own stored name
//
// All six are read from somewhere else rather than authored here, but they are
// still the compliance surface, and saying otherwise understated it for the one
// person reviewing this. The timeline is the one that matters most, which is why
// ./timeline.mjs picks its words from a closed list instead of printing a stored
// machine name.
//
// EXACTLY THREE OF THOSE STRINGS NAME A REGULATOR, and none of them says
// anything happened:
//
//   "CFPB complaint"                          stage.roundLabel — the rung's name
//   "State attorney general complaint"        stage.roundLabel — the rung's name
//   "CFPB and state attorney general filings" a PRICE LINE for an add-on the
//                                             client can buy, from
//                                             src/waypoints/pricing.mjs
//
// The third is the one worth reading twice. It is the label on a $20 line item,
// so it describes a product, not an event — but it does put the word "filings"
// in front of a client, and that is disclosed rather than argued away. It is not
// changed here because src/waypoints/pricing.mjs is another lane's file.
// src/http/client-progress.pg.test.mjs holds these three by exact value, so a
// FOURTH regulator string cannot appear in this payload without failing a test.
//
// NULL MEANS UNKNOWN AND MUST SURVIVE (CLAUDE.md §12). Not one field in here
// substitutes 0, "" or a value from a neighbouring column for something the
// database did not answer.
//
// NOTHING HERE SAYS "credit repair" (owner-set). The internal tables, the
// entitlement codes and the letters keep their names — renaming a stored value
// breaks the feature silently — and the six client-facing strings above are
// funding-optimisation and capital-readiness wording.
//
// ROUNDS 4 AND 5 ARE NEVER RETURNED AS FILED unless a client said they filed.
// See ./escalations.mjs. Nothing in this branch writes that report, so `filed`
// is false for every client today.
//
// COMPLIANCE REVIEW REQUIRED — fee timing. `paidServices` quotes a price for a
// self-serve dispute round. It charges nobody: there is no processor call in
// this file, no stored card token is readable from it, and the only rail this
// repository has is a hosted checkout link a human clicks.

import { clientRepairView } from "../repair/portal.mjs";
import { readRepairStage, REPAIR_PIPELINE } from "../repair/pipeline.mjs";
import { onRepairPath } from "../repair/on-repair-path.mjs";
import { listWaypoints } from "../waypoints/store.mjs";
/* The PUBLIC name of the buyable service, imported rather than retyped — see
   publicServiceKey() below for why this file must not emit the stored one.
   netlify/functions/api.mjs imports every handler into one process, so
   round.mjs is already loaded on any request that reaches this file. */
import { SERVICE_KEY as PAID_ROUND_PUBLIC_KEY, roundPriceList } from "../paid-services/round.mjs";
import { roundLadderEntry } from "../metro2/letters/catalog.mjs";
import {
  personalPanels, businessPanels, middleScore, scoreSeries, scoresOfResult, isoOrNull
} from "./scores.mjs";
import { progressTimeline } from "./timeline.mjs";
import {
  escalationStates, ESCALATION_LETTERS_SQL, ESCALATION_ROUNDS
} from "./escalations.mjs";
import { COMPLAINT_TARGET } from "../metro2/rounds/complaint-filing.mjs";
/* The one share-link builder in this repository. See readReferral() below. */
import { shareUrlFor } from "../affiliates/share-link.mjs";

/* The deliverable subtype that IS the personal credit report. Written by
   src/underwrite/funding-letter-pdf.mjs's FUNDING_ANALYSIS_SUBTYPE map, which is
   where the name comes from — it is not chosen here. */
const PERSONAL_REPORT_SUBTYPE = "credit_analysis_report";

/* DEVIATION (contract: `scores.business[].reportDocumentId`). There is no
   PER-BUSINESS report document in this system. `business_prep_summary` is the
   only business-shaped deliverable and there is one per CLIENT, so every
   business panel would open the same page. Pointing three toggles at one
   document is worse than an honest null, so business panels get null until a
   per-business report exists. Nothing here builds a second report renderer. */
const BUSINESS_REPORT_SUBTYPE = null;

/* A paid_service_requests row in one of these statuses is money already in
   motion, so the screen must refuse a second press rather than trust a disabled
   button. 'failed', 'cancelled' and 'refunded' are finished and do not block. */
const IN_FLIGHT_STATUSES = new Set(["quoted", "awaiting_payment", "paid", "staged"]);

/** The self-serve round's service key, as stored in paid_service_requests. */
export const PAID_ROUND_SERVICE_KIND = "dispute_round";

/**
 * @param {object} db
 * @param {{orgId: string, clientId: string, now?: Date}} opts
 * @returns {Promise<object>} the contract payload, without the `ok` envelope.
 */
export async function readClientProgress(db, { orgId, clientId, now = new Date() } = {}) {
  if (!db?.query) throw new Error("db required");
  if (!orgId || !clientId) throw new Error("orgId and clientId are required");

  const [
    crsRows, businessRows, documentRows, programRow, caseRow, cardRow,
    waypointRows, paidRows, itemCounts, timeline, repairPath, customFields,
    escalationRows
  ] = await Promise.all([
    /* EVERY crs_results row, no LIMIT — the same read portal-summary.mjs
       already makes. The newest is the panel and the whole list is the series,
       so the series genuinely costs a mapping function and not a query. */
    soft("crs_results", [], () => db.query(
      `SELECT id, created_at, result
         FROM crs_results
        WHERE client_id = $1::uuid AND org_id = $2::uuid
          AND is_demo IS NOT TRUE
        ORDER BY created_at DESC`,
      [clientId, orgId]
    ).then((r) => r.rows)),

    /* ORDERED BY created_at, NOT updated_at. The panel toggles between
       businesses and the order it toggles in must not change because somebody
       edited an address — portal-summary orders by updated_at, which is right
       for "show me the freshest one" and wrong for a stable tab strip.

       updated_at IS DELIBERATELY NOT SELECTED. It used to be, and it was used as
       the business score's pull date, which was wrong: a trigger rewrites it on
       every edit to the row. Leaving the column in the row object is an
       invitation to make that mistake again. */
    soft("businesses", [], () => db.query(
      `SELECT id, name, age_months, entity_data, created_at
         FROM businesses
        WHERE client_id = $1::uuid AND org_id = $2::uuid
        ORDER BY created_at ASC, id ASC`,
      [clientId, orgId]
    ).then((r) => r.rows)),

    soft("documents", [], () => db.query(
      `SELECT id, subtype, title, generated_at
         FROM documents
        WHERE client_id = $1::uuid AND org_id = $2::uuid
          AND kind = 'deliverable'
        ORDER BY generated_at DESC`,
      [clientId, orgId]
    ).then((r) => r.rows)),

    soft("repair_programs", null, () => db.query(
      `SELECT rounds_cap, program, status
         FROM repair_programs
        WHERE client_id = $1::uuid AND org_id = $2::uuid
        LIMIT 1`,
      [clientId, orgId]
    ).then((r) => r.rows[0] || null)),

    /* The live round and the honest due date, from the cases that are still
       open. A closed or cancelled case is not what the client is waiting on. */
    soft("dispute_cases", null, () => db.query(
      `SELECT MAX(round) AS round, MIN(response_due_at) AS response_due_at
         FROM dispute_cases
        WHERE client_id = $1::uuid AND org_id = $2::uuid
          AND status NOT IN ('closed', 'cancelled')`,
      [clientId, orgId]
    ).then((r) => r.rows[0] || null)),

    soft("cards.entered_at", null, () => db.query(
      `SELECT c.entered_at
         FROM cards c
         JOIN pipelines p ON p.id = c.pipeline_id AND p.key = $3
        WHERE c.org_id = $1::uuid AND c.client_id = $2::uuid
        LIMIT 1`,
      [orgId, clientId, REPAIR_PIPELINE]
    ).then((r) => r.rows[0] || null)),

    soft("client_waypoints", [], () => listWaypoints(db, { orgId, clientId, now })),

    soft("paid_service_requests", [], () => db.query(
      `SELECT id, service_kind, status, price_total_cents, round_no, requested_at
         FROM paid_service_requests
        WHERE client_id = $1::uuid AND org_id = $2::uuid
        ORDER BY requested_at DESC`,
      [clientId, orgId]
    ).then((r) => r.rows)),

    /* WHAT ACTUALLY MOVED. `deleted` is the bureau removing the item, which is
       the outcome the client paid for. Both the status column and the outcome
       column are checked because applyItemOutcome writes the outcome and the
       status separately and an older row can carry only one of them. */
    soft("dispute_items", { removed: null, disputed: null }, () => db.query(
      `SELECT COUNT(*)::int AS disputed,
              COUNT(*) FILTER (
                WHERE status = 'deleted' OR outcome = 'deleted'
              )::int AS removed
         FROM dispute_items
        WHERE client_id = $1::uuid AND org_id = $2::uuid`,
      [clientId, orgId]
    ).then((r) => ({
      removed: r.rows[0] ? Number(r.rows[0].removed) : null,
      disputed: r.rows[0] ? Number(r.rows[0].disputed) : null
    }))),

    progressTimeline(db, { orgId, clientId }),

    soft("on_repair_path", false, () => onRepairPath(db, { orgId, clientId })),

    /* One read of custom_fields, shared by the referral panel and the R4/R5
       filing report. Both use it as the repository's existing extension point
       (see readReferral below and ./escalations.mjs), so reading it twice would
       be two round trips for one row. */
    soft("clients.custom_fields", null, () => db.query(
      `SELECT custom_fields FROM clients WHERE id = $1::uuid AND org_id = $2::uuid`,
      [clientId, orgId]
    ).then((r) => r.rows[0]?.custom_fields || null)),

    /* R4 and R5 complaint letters — prepared ones as well as posted ones, which
       is why loadComplaintFilings() cannot be reused here: it returns only rows
       already accepted by the mail provider, and "prepared" is a state this page
       has to be able to show. */
    soft("escalation_letters", [], () => db.query(
      ESCALATION_LETTERS_SQL,
      [clientId, orgId, Object.values(COMPLAINT_TARGET), [...ESCALATION_ROUNDS]]
    ).then((r) => r.rows))
  ]);

  const referral = await readReferral(db, { orgId, clientId, customFields });

  const stageKey = await soft("repair_stage", null,
    () => readRepairStage(db, { orgId, clientId }));

  // ── scores ───────────────────────────────────────────────────────────────
  const personalReportId = newestDocumentId(documentRows, PERSONAL_REPORT_SUBTYPE);
  const businessReportId = newestDocumentId(documentRows, BUSINESS_REPORT_SUBTYPE);
  const personal = personalPanels(crsRows, { reportDocumentId: personalReportId });
  const business = businessPanels(businessRows, { reportDocumentId: businessReportId });

  // ── movement ─────────────────────────────────────────────────────────────
  const series = scoreSeries(crsRows);
  const nowPoint = series.length ? series[series.length - 1] : null;
  const basePoint = series.length ? series[0] : null;
  /* BASELINE AND NOW ARE THE SAME POINT WHEN THERE IS ONLY ONE PULL, and that
     is correct: the baseline is where this file started, and with one pull that
     is also where it is. It is not null — a real measurement exists — and the
     screen can see they match. */
  const movement = {
    middleScoreNow: nowPoint ? middleScore(nowPoint) : null,
    middleScoreBaseline: basePoint ? middleScore(basePoint) : null,
    baselineAt: basePoint ? basePoint.at : null,
    itemsRemoved: itemCounts.removed,
    itemsDisputed: itemCounts.disputed,
    series
  };

  // ── stage ────────────────────────────────────────────────────────────────
  const responseDueAt = caseRow ? caseRow.response_due_at || null : null;
  /* clientRepairView() decides WHETHER an expected date is honest to show. It
     only fills one in for the two stages where the bureaus really are on the
     clock, and it is the only written answer to that question — it has had zero
     callers since it was merged. This is its first one.

     DEVIATION (contract: `stage.expectedResponseBy` as ISO 8601). The function
     returns a YYYY-MM-DD string, because it was written to be printed. The
     contract asks for a full ISO timestamp in UTC, so the function is used as
     the GATE and the underlying timestamp is what is returned. Its judgement is
     honoured exactly; only the formatting differs. */
  const view = clientRepairView({ stageKey, responseDueAt });
  const stage = {
    key: stageKey,
    roundCurrent: roundNumber(caseRow && caseRow.round),
    roundCap: programRow && programRow.rounds_cap != null
      ? Number(programRow.rounds_cap) : null,
    enteredAt: isoOrNull(cardRow && cardRow.entered_at),
    expectedResponseBy: view.expectedResponseBy ? isoOrNull(responseDueAt) : null,
    waitingOn: null   // filled in below, once the next step is known
  };
  /* The rung's label, so the screen can name the round without a second copy of
     the ladder. roundLadderEntry() is the one that already knows R6 reuses the
     Round 3 letter and says so out loud. */
  const ladder = stage.roundCurrent ? roundLadderEntry(`R${stage.roundCurrent}`) : null;
  stage.roundLabel = ladder ? ladder.title : null;

  // ── waypoints and the single next step ───────────────────────────────────
  const waypoints = waypointRows.map(waypointView);
  const next = nextStepOf(waypoints);
  stage.waitingOn = waitingOn({ stageKey, next });

  // ── paid services ────────────────────────────────────────────────────────
  const paidServices = [paidRoundOffer({ paidRows, repairPath })];

  return {
    stage,
    scores: { personal, business },
    movement,
    waypoints,
    nextStep: next,
    /* ADDITION TO THE CONTRACT (owner-set 2026-09-05, after the contract was
       written). Rounds 4 and 5 in three states — prepared, sent, filed — so the
       screen can say a complaint left us without ever saying it was filed. An
       empty array means this client has never reached R4. */
    escalations: escalationStates(escalationRows, customFields),
    timeline,
    deliverables: documentRows.map((d) => ({
      documentId: d.id,
      subtype: d.subtype || null,
      title: d.title || null,
      generatedAt: isoOrNull(d.generated_at)
    })),
    paidServices,
    referral
  };
}

/* ── waypoints ─────────────────────────────────────────────────────────────
 *
 * DEVIATION (contract: `waypoints[].state`). The contract's examples show
 * "open" and "available". The database's CHECK allows exactly
 * not_started | in_progress | blocked | done | skipped (db/migrations/330), and
 * inventing a second vocabulary in the endpoint would mean the screen and the
 * staff tooling describe the same row with different words. The stored value is
 * returned. `overdue` and `paidAlternative` are exactly as specified.
 *
 * NO LONGER A DEVIATION, and the reason the old one gave was wrong. This used to
 * return the STORED kind (dispute_round | credit_pull | funding_application,
 * db/migrations/331) with the note "so a screen can post it straight back". A
 * screen cannot: api/paid-services.mjs refuses anything but "paid_round" with
 * `unknown_service`. The contract's "paid_round" is now what is returned, via
 * publicServiceKey(), and the stored kind stays internal where it belongs.
 *
 * `paidAlternative` is null when there is no paid option. Null means NONE. It
 * must never be rendered as free — and it cannot silently become a zero price,
 * because 330's CHECK refuses 0 in that column outright.
 */
function waypointView(row) {
  const price = row.paid_alternative_price_cents;
  return {
    id: row.id,
    order: row.position == null ? null : Number(row.position),
    title: row.title,
    owner: row.owner_kind,
    state: row.state,
    dueAt: isoOrNull(row.due_at),
    overdue: !!row.overdue,
    completedAt: isoOrNull(row.completed_at),
    paidAlternative: price == null ? null : {
      // Translated for the same reason paidServices[].serviceKey is — see
      // publicServiceKey(). A screen posts this value to api/paid-services.mjs,
      // which refuses the stored kind outright.
      serviceKey: row.paid_alternative_kind ? publicServiceKey(row.paid_alternative_kind) : null,
      label: row.paid_alternative_label || null,
      priceCents: Number(price)
    }
  };
}

const OPEN_STATES = new Set(["not_started", "in_progress", "blocked"]);

/**
 * EXACTLY ONE waypoint, so the page can always answer "whose move is it".
 *
 * The client's own open work comes first, because that is the only kind the
 * client can act on. With nothing owed by them it names what FundHub owes, so
 * the answer is "we are working on it" rather than an empty panel.
 *
 * Returns null only when there is no open waypoint at all — nothing is owed by
 * anybody, which is a real state and not a missing one.
 */
export function nextStepOf(waypoints = []) {
  const open = waypoints.filter((w) => OPEN_STATES.has(w.state));
  const mine = open.find((w) => w.owner === "client");
  const chosen = mine || open[0] || null;
  return chosen ? { waypointId: chosen.id, owner: chosen.owner } : null;
}

/* WHO THE FILE IS WAITING ON. The bureaus win when the stage says the letters
   are out, because that is true no matter what is on the checklist. Otherwise
   it follows the next step. Null when the stage is unknown and there is no open
   waypoint — nobody knows, and "fundhub" would be a guess. */
export function waitingOn({ stageKey, next }) {
  if (stageKey === "in_transit" || stageKey === "awaiting_response") return "bureaus";
  if (next) return next.owner === "client" ? "client" : "fundhub";
  return null;
}

/* ── the paid round ────────────────────────────────────────────────────────
 *
 * Owner-set pricing lives in src/waypoints/pricing.mjs and is read from there,
 * not restated. The two optional components are listed whether or not this
 * client needs them, because the screen shows the price breakdown before the
 * round is built and therefore before anyone knows which apply.
 *
 * A PAID ROUND DOES NOT CONSUME repair_programs.rounds_cap. Nothing in this
 * function reads the cap, and `stage.roundCap` above is a separate counter.
 */
/* publicServiceKey — the stored kind translated to the name a screen may POST.
 *
 * THESE ARE TWO DIFFERENT NAMES AND THE DIFFERENCE IS LOAD-BEARING.
 *
 *   paid_service_requests.service_kind is 'dispute_round' | 'credit_pull' |
 *   'funding_application' — a CHECK-constrained column (331:147-149). It is the
 *   INTERNAL name of the work.
 *
 *   api/paid-services.mjs accepts exactly one service name and refuses every
 *   other with `unknown_service`: SERVICE_KEY, which is "paid_round"
 *   (src/paid-services/round.mjs:79). That is the PUBLIC name, and it is the
 *   name docs/workflows/portal-progress-contract.md:106 specifies.
 *
 * This file used to return the stored kind for both `paidServices[].serviceKey`
 * and `waypoints[].paidAlternative.serviceKey`, with a comment reasoning that a
 * screen could "post it straight back". IT COULD NOT. Posting `dispute_round`
 * back to api/paid-services.mjs is a 400 with `unknown_service`, and the front
 * end selects the round card by matching "paid_round" — so the card did not
 * render at all and, had it rendered, the button would have failed. Measured on
 * the merge of this branch with the front end, 2026-09-05.
 *
 * So the translation happens here, at the boundary, which is where a public name
 * and a storage value are supposed to diverge. Rows are still MATCHED on the
 * stored kind — see inFlight below; nothing about the query changed.
 *
 * A kind with no public endpoint yet passes through unchanged rather than being
 * given an invented public name. The screen has an honest "not switched on yet"
 * state for a key it does not recognise, which is the correct answer for
 * credit_pull and funding_application today: nothing sells them.
 */
export function publicServiceKey(storedKind) {
  return storedKind === PAID_ROUND_SERVICE_KIND ? PAID_ROUND_PUBLIC_KEY : storedKind;
}

export function paidRoundOffer({ paidRows = [], repairPath = false } = {}) {
  /* THE COMPONENT LIST IS NOT BUILT HERE. It comes from roundPriceList()
     (src/paid-services/round.mjs), which is the same list GET /api/paid-services
     serves.
     THIS FILE USED TO BUILD ITS OWN, KEYED ON PRICE_CODES — round_base,
     creditor_letter, escalation_filings. Those are the INTERNAL line codes from
     src/waypoints/pricing.mjs. The contract
     (docs/workflows/portal-progress-contract.md:108-110) and the buy endpoint
     both name the same three things base / creditor / cfpb_and_ag, so the two
     reads of one product handed a screen two different sets of keys. Measured
     against both live endpoints on one client, 2026-09-05.
     It is the same fault as the serviceKey above and in the same function: an
     internal value emitted as a public one. Reusing the public list is also the
     only way the add-on prices stay derived by subtraction from what is actually
     charged, which is the property roundPriceList()'s own header exists to keep. */
  const inFlight = (paidRows || []).some(
    (r) => r.service_kind === PAID_ROUND_SERVICE_KIND && IN_FLIGHT_STATUSES.has(r.status)
  );
  return {
    // The PUBLIC name. The stored kind is still what inFlight matches on below.
    serviceKey: publicServiceKey(PAID_ROUND_SERVICE_KIND),
    // Offered to clients on the optimisation path only. onRepairPath() is the
    // one rule for that and it fails closed, so an unreadable entitlement table
    // hides the button rather than selling a round to a course buyer (F35).
    available: !!repairPath && !inFlight,
    components: roundPriceList(),
    inFlight
  };
}

/* ── referral ──────────────────────────────────────────────────────────────
 *
 * NO LONGER A DEVIATION. When this was written there genuinely was no link from
 * a client to their own affiliate row: accounts_subject_ck (044:65-71) allowed
 * exactly one subject per account, so a client account could not carry an
 * affiliate_id, and accounts_email_uniq meant a second account was not available
 * either. That note was correct on the day it was written.
 *
 * db/migrations/340_client_light_affiliate.sql relaxed that constraint in one
 * direction — a client may also hold an affiliate_id — which is the owner
 * decision in portal-rebuild-plan.md section 4 ("clients become light
 * affiliates"). So the link exists now, and this reads it.
 *
 * `code` is affiliates.tracking_id, the AFF-nnnnnn a trigger assigns on insert.
 *
 * `shareUrl` IS RETURNED NOW, and not built from request headers — the old note
 * was right that guessing an origin mints a link that 404s. shareUrlFor()
 * (api/affiliates/refer.mjs) resolves the configured base exactly as
 * src/messaging/unsubscribe.mjs:234 does, and it is the ONE share-link builder
 * in this repository. Returning it here means the page and the enrolment reply
 * cannot disagree about a link the client is about to hand to a friend.
 */
async function readReferral(db, { orgId, clientId, customFields }) {
  const none = { enrolled: false, shareUrl: null, code: null };
  return soft("referral", none, async () => {
    /* THE REAL LINK FIRST. accounts.affiliate_id on the client's own account.
       A unique index sits under it (044:81) and the CHECK that allows it is
       explicit (340), so exactly one affiliate row can ever be on one account —
       which a jsonb field cannot promise. api/affiliates/refer.mjs is what
       writes it, inside the same transaction that creates the affiliate row. */
    const linked = await db.query(
      `SELECT a.tracking_id
         FROM accounts acc
         JOIN affiliates a ON a.id = acc.affiliate_id AND a.org_id = acc.org_id
        WHERE acc.client_id = $1::uuid AND acc.org_id = $2::uuid
        LIMIT 1`,
      [clientId, orgId]
    );
    const linkedCode = linked.rows[0]?.tracking_id || null;
    if (linkedCode) return { enrolled: true, shareUrl: shareUrlFor(linkedCode), code: linkedCode };

    /* THE FALLBACK, kept deliberately. custom_fields.referral_affiliate_id was
       this file's original source and may already hold a link on a file that
       predates the account column. Reading both means neither lane's assumption
       silently stops working; the real link simply wins when both exist. */
    const raw = customFields?.referral_affiliate_id;
    const id = raw == null ? "" : String(raw).trim();
    if (!id) return none;
    const a = await db.query(
      `SELECT tracking_id FROM affiliates WHERE id = $1::uuid AND org_id = $2::uuid`,
      [id, orgId]
    );
    const code = a.rows[0]?.tracking_id || null;
    return code ? { enrolled: true, shareUrl: shareUrlFor(code), code } : none;
  });
}

/* ── helpers ───────────────────────────────────────────────────────────── */

/* One read may not take the whole page down with it. The same shape
   api/read/portal-summary.mjs uses for its four stage reads, and for the same
   reason: a client whose decision log is unreadable should lose the timeline,
   not their scores. */
async function soft(label, fallback, run) {
  try {
    return await run();
  } catch (err) {
    console.warn(`[client-progress] ${label} read failed:`, err && err.message);
    return fallback;
  }
}

/** 'R3' → 3. FURNISHER, null and anything unrecognised → null, never 0. */
export function roundNumber(round) {
  const m = /^R([1-9][0-9]*)$/.exec(String(round || "").trim().toUpperCase());
  return m ? Number(m[1]) : null;
}

function newestDocumentId(rows, subtype) {
  if (!subtype) return null;
  const hit = (rows || []).find((d) => d.subtype === subtype);
  return hit ? hit.id : null;
}

export { scoresOfResult };

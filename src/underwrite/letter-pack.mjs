// In-repo Underwrite IQ pack. Letters from letter-generator. Analysis docs
// from the WeasyPrint black-report printer (credit analysis, roadmap,
// funding snapshot, lender list) filled from UnderwriteIQ data. No Claude JSON dump.

import letterGenMod from "./vendor/letter-generator.cjs";
import summaryMod from "./vendor/summary-doc-generator.cjs";
import buildDocsMod from "./vendor/build-documents.cjs";
import generateDeliverablesMod from "./vendor/generate-deliverables.cjs";
import { runTierEngineFromCrsResult } from "../finance/crs-tier.mjs";
import { hasFundingAnalysisPdfs, FUNDING_ANALYSIS_FILENAMES } from "./letter-pack-filter.mjs";
import { buildBlackReportClient, hasBlackReportSource, mergeStoredUnderwrite } from "./black-report-client.mjs";
import { printBlackReports } from "./black-report-pdf.mjs";
import { violationsByBureauFromMergedCrs } from "../metro2/diy/from-crs.mjs";
import { derogatoryClaimsByBureau, mergeDerogatoryClaims } from "../metro2/diy/derogatory.mjs";
import { maybeComplaintFiles, COMPLAINT_FOLDER } from "../metro2/diy/package.mjs";
import { LETTER_TYPES } from "../metro2/letters/catalog.mjs";
import {
  loadPriorOutcomes,
  stampPriorOutcomes,
  reachedEscalation,
  highestEscalationRound
} from "./prior-outcome.mjs";

const { generateLetters, generateDisputeLetters } = letterGenMod;
const { generateAllSummaryDocuments } = summaryMod;
const { buildDocuments } = buildDocsMod;
const { generateDeliverables } = generateDeliverablesMod;

const FUNDING_SUMMARIES = new Set(["funding_summary", "business_prep_summary"]);
const REPAIR_SUMMARIES = new Set(["repair_plan_summary", "issue_priority_sheet"]);

/* The outcome tiers that put a client on the repair path, same pair the
   specialist desk uses (../repair/analyze.mjs REPAIR_PATH_TIERS). REPAIR_ONLY is
   repair alone; FUNDING_PLUS_REPAIR is repair alongside funding. The ladder
   itself is listed in ../config/product-path.mjs.

   ../repair/on-repair-path.mjs is the fuller answer — it also honours the
   `metro2-letter-pack` entitlement, which a repair buyer holds before any pull
   has run — but it needs an org id to bind the read to one tenant, and
   buildLetterPackForClient is handed a client id and nothing else. The tier is
   what this file can actually see, so the tier is what it uses. */
const REPAIR_PATH_TIERS = new Set(["REPAIR_ONLY", "FUNDING_PLUS_REPAIR"]);

// ═══════════════════════════════════════════════════════════════════════════════
// WHY `reason` IS MORE THAN "empty_pack"
//
// Until 2026-08-19 every pack that came out with zero files reported the single
// string "empty_pack". That one string covered three states a human has to tell
// apart:
//
//   1. the tier engine was never handed anything to score (no credit pull yet),
//   2. the tier engine threw (bad or incomplete stored pull), and
//   3. the engine ran fine and this client genuinely has nothing to send.
//
// Only (3) is a normal business outcome. (1) and (2) are faults. Reporting all
// three identically is what let the demo seed sit broken: crs_results.result had
// no `bureaus` key, runTierEngineFromCrsResult threw "no bureau reports to score"
// (src/finance/crs-tier.mjs:37), buildLetterPackForClient caught it into
// engineSkip, and the caller was told "empty_pack" — indistinguishable from a
// clean client with no disputes.
//
// The distinction has to live in `reason` itself, not in a sibling field. Both
// callers collapse the result down to that one string on the failure path —
// src/workflows/c-06-crs-results-router.mjs:93 and
// src/workflows/ds-02-diy-letters.mjs:65 both read `pack.reason || pack.engineSkip`,
// so a non-null `reason` always wins and ds-02 drops `engineSkip` entirely. A new
// field would be silently discarded on the way out.
// ═══════════════════════════════════════════════════════════════════════════════
export const PACK_REASON = Object.freeze({
  /** No engine result was handed to buildLetterPack at all. */
  NO_ENGINE_RESULT: "no_engine_result",
  /** This client has no stored credit pull yet. Normal early state, not a fault. */
  NO_CRS_RESULT: "no_crs_result",
  /** The tier engine threw. Prefixes the real message: `engine_error: <message>`. */
  ENGINE_ERROR: "engine_error",
  /** Engine ran, and produced nothing to send. The only benign empty pack. */
  EMPTY_PACK: "empty_pack",
  MISSING_FUNDING_ANALYSIS: "missing_funding_analysis",
  NO_CLIENT: "no_client",
  PACK_ERROR: "pack_error"
});

const NICE_NAME = {
  ...FUNDING_ANALYSIS_FILENAMES,
  funding_summary: "Capital-Readiness-Summary.pdf",
  repair_plan_summary: "Optimization-Plan-Summary.pdf",
  business_prep_summary: "Business-Readiness-Guide.pdf",
  [LETTER_TYPES.CFPB_COMPLAINT]: "CFPB-Complaint.pdf",
  [LETTER_TYPES.STATE_AG_COMPLAINT]: "State-Attorney-General-Complaint.pdf"
};

export function personalFromClient(row) {
  if (!row) return { name: "Client", address: "" };
  const cf = row.custom_fields && typeof row.custom_fields === "object" ? row.custom_fields : {};
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Client";
  const street = String(cf.address || cf.mailing_address || cf.street_address || cf.address_line1 || "").trim();
  const city = String(cf.city || cf.mailing_city || "").trim();
  const state = String(cf.state || cf.mailing_state || "").trim();
  const zip = String(cf.zip || cf.postal_code || cf.mailing_zip || "").trim();
  const cityLine = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const address = [street, cityLine].filter(Boolean).join("\n");
  return {
    name,
    address,
    city,
    state,
    zip,
    ssn: cf.ssn || cf.social_security_number || null,
    dob: cf.dob || cf.date_of_birth || null,
    employer: cf.employer || cf.current_employer || null
  };
}

function formatIdentityName(n) {
  if (!n || typeof n !== "object") return "";
  return n.full || n.display || [n.first, n.middle, n.last].filter(Boolean).join(" ").trim();
}

export function bureausFromEngine(engine) {
  const empty = () => ({ tradelines: [], inquiries: 0, inquiryList: [], names: [], addresses: [], employers: [], ssns: [], dobs: [] });
  const by = { experian: empty(), transunion: empty(), equifax: empty() };
  if (!engine) return by;
  const tradelines = engine.normalized?.tradelines || [];
  const inquiries = engine.normalized?.inquiries || [];
  const identity = engine.normalized?.identity || {};
  for (const t of tradelines) {
    const key = t.source;
    if (!by[key]) continue;
    by[key].tradelines.push({
      creditor: t.creditorName || t.creditor,
      creditorName: t.creditorName || t.creditor,
      status: t.status,
      is_negative: !!(t.isDerogatory || t.is_negative),
      isDerogatory: !!(t.isDerogatory || t.is_negative),
      balance: t.currentBalance ?? t.balance ?? null,
      currentBalance: t.currentBalance ?? t.balance ?? null,
      pastDue: t.pastDue ?? t.past_due ?? null,
      accountId: t.accountIdentifier || t.accountId || t.accountNumber,
      accountIdentifier: t.accountIdentifier || t.accountId || t.accountNumber,
      dateReported: t.reportedDate || t.dateReported || t.lastReported,
      reportedDate: t.reportedDate || t.dateReported || t.lastReported,
      openedDate: t.openedDate || t.dateOpened || null,
      closedDate: t.closedDate || t.dateClosed || null,
      accountType: t.accountType ?? null,
      currentRatingType: t.currentRatingType || null,
      comments: t.comments || [],
      chargeOffAmount: t.chargeOffAmount ?? null,
      complianceConditionCode: t.complianceConditionCode || null,
      inferredDofd: t.inferredDofd || t.dofd || null,
      ownership: t.ownership || null,
      isAU: !!t.isAU,
      priorOutcome: t.priorOutcome || null
    });
  }
  for (const i of inquiries) {
    if (!by[i.source]) continue;
    by[i.source].inquiries += 1;
    by[i.source].inquiryList.push({
      creditor: i.creditorName || i.creditor || i.subscriber || "Unknown",
      creditorName: i.creditorName || i.creditor || i.subscriber || "Unknown",
      date: i.date || i.inquiryDate || ""
    });
  }
  const idSource = identity.bySource || {};
  for (const key of Object.keys(by)) {
    const named = (arr, pick) => (arr || []).filter((row) => !row || !row.source || row.source === key).map(pick).filter(Boolean);
    const slice = idSource[key];
    by[key].names = slice
      ? (slice.names || []).map((n) => (typeof n === "string" ? n : n.full || n.display || "")).filter(Boolean)
      : named(identity.names, (n) => (typeof n === "string" ? n : formatIdentityName(n)));
    by[key].addresses = slice
      ? (slice.addresses || []).map((a) => (typeof a === "string" ? a : [a.line1, a.city, a.state, a.zip].filter(Boolean).join(", "))).filter(Boolean)
      : named(identity.addresses, (a) => (typeof a === "string" ? a : [a.line1 || a.addressLine1, a.city, a.state, a.zip || a.postalCode].filter(Boolean).join(", ")));
    by[key].employers = slice
      ? (slice.employers || []).map((e) => (typeof e === "string" ? e : e.name || "")).filter(Boolean)
      : named(identity.employers, (e) => (typeof e === "string" ? e : e.name || e.employerName || ""));
    by[key].ssns = slice
      ? (slice.ssns || []).map((s) => (typeof s === "string" ? s : s.value || "")).filter(Boolean)
      : named(identity.ssns, (s) => (typeof s === "string" ? s : s.value || s.ssn || ""));
    by[key].dobs = slice
      ? (slice.dobs || []).map((d) => (typeof d === "string" ? d : d.value || "")).filter(Boolean)
      : named(identity.dobs, (d) => (typeof d === "string" ? d : d.value || d.dob || ""));
  }
  return by;
}

function asFiles(list) {
  return (list || [])
    .filter((p) => p && p.buffer)
    .map((p) => {
      const type = p.docType || p.type || null;
      const bureau = p.bureau || null;
      return {
        filename: NICE_NAME[type] || String(p.filename || "letter.pdf"),
        contentType: "application/pdf",
        content: p.buffer,
        ...(type ? { type } : {}),
        ...(bureau ? { bureau } : {})
      };
    });
}

async function uiqDeliverablePdfs(crsResult, personal, pack, _generate = generateDeliverables, storedCrs = null) {
  if (pack !== "funding") return { files: [], skip: "not_funding" };
  if (!crsResult && !storedCrs) return { files: [], skip: "no_engine" };
  const source = mergeStoredUnderwrite(crsResult, storedCrs);
  if (!source) return { files: [], skip: "no_engine" };
  if (!hasBlackReportSource(source)) return { files: [], skip: "no_scores" };
  try {
    const client = buildBlackReportClient({ crsResult: source, personal });
    const printed = await printBlackReports({ client });
    const files = printed.files || [];
    // Which printer actually ran, carried out of here on purpose. For six weeks
    // the WeasyPrint printer was silently replaced by the short pdf-lib one and
    // nothing recorded it, so nobody could tell a client who got the designed
    // documents from one who did not. See src/underwrite/black-report-pdf.mjs.
    const engine = printed.engine || null;
    const engineReason = printed.engineReason || null;
    if (!files.length) return { files: [], skip: printed.skip || "render_empty", engine, engineReason };
    return { files, skip: null, engine, engineReason };
  } catch (err) {
    return { files: [], skip: String(err && err.message || err).slice(0, 240), engine: null, engineReason: null };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE ESCALATION LADDER
//
// COMPLIANCE REVIEW REQUIRED — dispute logic and credit-repair messaging.
//
// Owner-set 2026-08-28: the repair pack carries the escalation ladder, not just
// the three bureau letters. Until now `pack === "repair"` produced Metro 2 bureau
// letters only, while the Round 3 letter text already told the bureau a CFPB
// complaint was being filed and nothing ever wrote one.
//
// Nothing is authored here and nothing is re-implemented here. The complaint
// pair, its wording, its sworn declaration and the cover sheet that must travel
// with it all come from the one builder the $1,000 DIY package uses:
//   src/metro2/diy/package.mjs  maybeComplaintFiles
// This file only decides WHETHER the pack has earned them, and renames the
// resulting files into the pack's own naming convention.
//
// THE TWO RULES THAT MATTER — read before touching this:
//
//   1. A complaint may never ship unless the client has ACTUALLY REACHED the
//      escalation rounds, R4 or later, on a recorded and human-confirmed answer.
//   2. A complaint may never ship without dispute letters in the SAME pack.
//
// Both complaints say, in the client's own voice and signed under penalty of
// perjury, "I disputed inaccurate information with the consumer reporting
// agencies." If that is not true, the client is being asked to swear to it
// anyway. Filing a federal complaint before the bureau rounds are done is also
// out of order — the CFPB and the state AG both expect them first, and the cover
// sheet that ships with these two PDFs says so in capitals.
//
// RULE 1 IS NEW, AND IT REPLACES A GATE THAT WAS WRONG (2026-08-28).
//
// Until now the only test was rule 2 — did this pack write any dispute letter at
// all. That is a proxy, and a weak one: a pack writes a Round 1 letter for a
// client on their very first day, so the complaints were released to a client
// who had disputed nothing yet and heard back from nobody. The sworn sentence
// was false and the complaints were out of order, which is the same defect
// already fixed on main in the Round 3 letter text.
//
// The round the client is actually on became knowable when the recorded bureau
// answer was wired to this pack (./prior-outcome.mjs). Rule 1 uses it. An item
// only sits at R4 because R1, R2 and R3 were each answered "verified" and a
// human confirmed each one (../metro2/inbound/confirm.mjs →
// ../metro2/rounds/state.mjs applyItemOutcome). Nothing else can put it there —
// not a default, not a guess, not an empty result set. See the header of
// ./prior-outcome.mjs `reachedEscalation`.
//
// RULE 2 IS KEPT, not replaced. It is now the pack-health check it always really
// was: if the engine produced no bureau letter this run, something is wrong with
// the pack and it ships nothing at all. It is reported first for that reason —
// "no_dispute_letters" means the pack broke, "not_escalated" means the client is
// simply not there yet, which is the normal state for almost every client.
//
// Neither rule reads the stored credit pull to decide. The pull says what the
// client COULD dispute, never what was disputed or what came back.
//
// The other rules held here, deliberately:
//  * No violations found → no complaint. A complaint with no named account is a
//    claim about nothing, so an empty findings map yields zero files.
//  * Undated. `datedComplaints: false` renders "Date: ____________" and the
//    hand-signed perjury declaration. A dated complaint requires the client's
//    dispute authorization, which this path does not carry.
//  * The timeline is the blank R1/R2/R3 plan, so every date reads
//    "[DATE — not mailed yet]". No mail date is ever invented.
//  * A failure here must not lose the bureau letters, so it is caught and
//    surfaced as `complaintSkip` rather than thrown.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A Metro 2 dispute round letter to a bureau — the thing a complaint escalates
 * FROM. Personal-info and inquiry-removal letters are not it.
 */
function isDisputeLetter(letter) {
  return letter?.type === "dispute" || /round\d/.test(letter?.filename || "");
}

/** Complaint identity from the same `personal` record the bureau letters use. */
export function complaintIdentityFromPersonal(personal) {
  const who = personal && typeof personal === "object" ? personal : {};
  const cityLine = [who.city, [who.state, who.zip].filter(Boolean).join(" ")]
    .filter(Boolean).join(", ");
  const lines = String(who.address || "").split("\n").map((l) => l.trim()).filter(Boolean);
  // personalFromClient joins street + cityLine with a newline. Drop the city line
  // so a client with no street on file gets a blank street, never their own city
  // printed as an address.
  const street = lines.find((l) => l !== cityLine) || "";
  const name = String(who.name || "").trim();
  return {
    fullName: name && name !== "Client" ? name : "",
    addressLine1: street,
    city: String(who.city || "").trim(),
    state: String(who.state || "").trim(),
    zip: String(who.zip || "").trim()
  };
}

/**
 * @param {object}   args
 * @param {object?}  args.storedCrs      the stored credit pull, for the findings
 * @param {object}   args.personal       the client record the letters were addressed from
 * @param {string}   args.pack           "repair" or "funding"
 * @param {object[]} args.disputeLetters the dispute letters THIS pack produced.
 *   Not optional and never defaulted: an empty list means no complaint. See
 *   RULE 2 above.
 * @param {object[]} args.priorOutcomes the recorded, human-confirmed bureau
 *   answers on file for this client (./prior-outcome.mjs loadPriorOutcomes).
 *   Not optional and never defaulted: an empty list means the client is on
 *   Round 1 and gets no complaint. See RULE 1 above.
 * @param {boolean} [args.onRepairPath] whether this client's offer path is a
 *   repair path. Defaults to false — see the derogatory block below.
 */
export async function buildEscalationComplaints({
  storedCrs,
  personal,
  pack,
  disputeLetters,
  priorOutcomes,
  onRepairPath = false
} = {}) {
  if (pack !== "repair") return { files: [], skip: "not_repair" };
  if (!(disputeLetters || []).some(isDisputeLetter)) {
    return { files: [], skip: "no_dispute_letters" };
  }
  // RULE 1. The client must have reached R4+ on a confirmed bureau answer. No
  // recorded answer means Round 1, and Round 1 has not earned a sworn complaint.
  if (!reachedEscalation(priorOutcomes)) {
    return { files: [], skip: "not_escalated" };
  }
  if (!storedCrs) return { files: [], skip: "no_stored_crs" };
  try {
    /* OWNER DECISION, 2026-09-03: "any derogatory deserves a letter, but only if
       they are in the correct offer path."

       This is the one place in this file that reads the Metro 2 engine, and the
       engine fires only on a reporting DEFECT. So a repair client who worked
       three bureau rounds on a file of collections and charge-offs — accounts
       reported cleanly, with no defect to find — reached R4 and was told
       "no_violations": the two complaints name accounts, and the engine had
       named none. They got their dispute letters (those come from the vendor
       writer, which reads the account's derogatory status, not the engine) and
       then nothing to escalate with.

       Derogatory items now carry their own claims — ../metro2/diy/derogatory.mjs
       for what they assert and why they are not Metro 2 rules — and only for a
       client on the repair path. Off that path this reads exactly as it did.

       Safe to merge here and nowhere near the dispute letters: the complaint
       builder names accounts and runs no variance gate over its output. */
    const engineFindings = violationsByBureauFromMergedCrs(storedCrs);
    const violationsByBureau = onRepairPath
      ? mergeDerogatoryClaims(engineFindings, derogatoryClaimsByBureau(storedCrs))
      : engineFindings;
    const built = await maybeComplaintFiles({
      identity: complaintIdentityFromPersonal(personal),
      violationsByBureau,
      // Undated. The client writes the date and hand-signs the declaration.
      datedComplaints: false
    });
    if (!built.ok) return { files: [], skip: built.reason || "complaint_refused" };
    if (!built.files.length) return { files: [], skip: "no_violations" };
    // Same folder, same cover sheet, same order as the DIY package. Only the two
    // PDF names change, onto this pack's naming convention.
    const files = built.files.map((f) => {
      const nice = NICE_NAME[f.type];
      return {
        filename: nice ? `${COMPLAINT_FOLDER}/${nice}` : f.path,
        contentType: f.pdf ? "application/pdf" : "text/plain",
        content: f.pdf || Buffer.from(String(f.text ?? ""), "utf8"),
        ...(f.type ? { type: f.type } : {})
      };
    });
    return { files, skip: null };
  } catch (err) {
    return { files: [], skip: String(err && err.message || err).slice(0, 240) };
  }
}

export async function buildLetterPack({
  crsResult,
  personal,
  pack = "funding",
  generateDeliverablesFn = generateDeliverables,
  storedCrs = null,
  // Confirmed bureau answers already on file. Empty means every account is
  // still on Round 1 — which is exactly the behaviour of this function before
  // the wire existed. See ./prior-outcome.mjs for why nothing may default here.
  priorOutcomes = [],
  // Whether this client's offer path is a repair path. False is the old
  // behaviour, so a caller that does not know the tier changes nothing.
  onRepairPath = false
} = {}) {
  const who = personal || { name: "Client", address: "" };
  const path = pack === "repair" ? "repair" : "fundable";
  const bureaus = bureausFromEngine(crsResult);
  // The one place a round advances. An account moves off Round 1 only because a
  // human confirmed the bureau's answer and the round machine recorded it.
  const rounds = stampPriorOutcomes(bureaus, priorOutcomes);
  const letters = await generateLetters({
    path,
    bureaus,
    personal: who,
    underwrite: { fundable: pack !== "repair" }
  });
  // generateLetters only emits bureau Metro 2 letters when path === "repair".
  // Gold funding packs still include those letters (LETTER_SPEC + owner roster).
  if (pack !== "repair" && !letters.some(isDisputeLetter)) {
    letters.push(...(await generateDisputeLetters({ bureaus, personal: who })));
  }
  let summaries = [];
  // Reported, not just swallowed. This catch used to drop the error on the floor,
  // the same silent-swallow that hid the engine fault below. Summaries are
  // optional to the pack so a failure here must not throw, but it must be visible.
  let summarySkip = crsResult?.normalized ? null : "no_normalized";
  if (crsResult?.normalized) {
    try {
      const outcome = crsResult.outcome
        || (pack === "repair" ? "REPAIR_ONLY" : "FULL_FUNDING");
      const docs = buildDocuments(
        outcome,
        crsResult.suggestions,
        crsResult.normalized,
        crsResult.consumerSignals
      );
      const allow = pack === "repair" ? REPAIR_SUMMARIES : FUNDING_SUMMARIES;
      const specs = (docs.summaryDocuments || []).filter((s) => allow.has(s.type));
      summaries = await generateAllSummaryDocuments(specs, crsResult, who);
    } catch (err) {
      summaries = [];
      summarySkip = String(err && err.message || err).slice(0, 240);
    }
  }
  const uiq = await uiqDeliverablePdfs(crsResult, who, pack, generateDeliverablesFn, storedCrs);
  const letterFiles = asFiles(letters);
  // The documents this pack produced on its own merits. Escalation is NOT in here.
  const earned = [...uiq.files, ...asFiles(summaries), ...letterFiles];
  // Escalation last: the client works the bureau rounds first, then files these,
  // and only if this pack actually wrote the bureau rounds.
  const escalation = await buildEscalationComplaints({
    storedCrs,
    personal: who,
    pack,
    disputeLetters: letterFiles,
    // The same recorded answers that moved the rounds above. A client who never
    // reached R4 gets no sworn complaint. See RULE 1 in the block above.
    priorOutcomes,
    onRepairPath
  });
  const files = [...earned, ...escalation.files];
  let reason = null;
  // An empty pack with no engine result is a different state from an empty pack
  // the engine produced. See the PACK_REASON block at the top of this file.
  //
  // Counted against `earned`, never against `files`. A complaint must never make
  // a failed pack look like it produced something — that is exactly how the
  // engine error below got swallowed once already.
  if (!earned.length) {
    reason = crsResult ? PACK_REASON.EMPTY_PACK : PACK_REASON.NO_ENGINE_RESULT;
  } else if (pack !== "repair" && !hasFundingAnalysisPdfs(files)) {
    reason = PACK_REASON.MISSING_FUNDING_ANALYSIS;
  }
  return {
    files,
    reason,
    deliverableCount: uiq.files.length,
    deliverableSkip: uiq.skip,
    // Which printer made the four analysis documents: "weasyprint" (local
    // Python), "weasyprint-remote" (render-service), or "pdf-lib" (the short
    // fallback set). "pdf-lib" on a real client means the render service was
    // unreachable and that client's documents are degraded.
    deliverableEngine: uiq.engine || null,
    deliverableEngineReason: uiq.engineReason || null,
    summarySkip,
    complaintCount: escalation.files.length,
    complaintSkip: escalation.skip,
    // How many accounts were moved off Round 1 by a recorded bureau answer, and
    // how many recorded answers named an account this pull does not contain.
    roundsAdvanced: rounds.stamped,
    roundsUnmatched: rounds.unmatched,
    // The furthest escalation round on record, or null when the client has not
    // reached one. This is what released the complaints, or what withheld them.
    escalationRound: highestEscalationRound(priorOutcomes)
  };
}

/**
 * Sharpen an empty-pack reason with what actually went wrong upstream.
 *
 * Only ever replaces a "nothing came out" reason — a pack that produced files
 * keeps its own reason (null, or missing_funding_analysis), because an engine
 * fault that still yielded letters is not the headline.
 *
 * `engineFault` is set ONLY when something threw. "no_crs_result" is deliberately
 * not a fault: it means this client has no credit pull on file yet, which is a
 * normal early state and must not be reported as an engine error.
 */
function sharpenEmptyReason(reason, { engineSkip, engineFault }) {
  if (reason !== PACK_REASON.NO_ENGINE_RESULT && reason !== PACK_REASON.EMPTY_PACK) {
    return reason;
  }
  if (engineFault) return `${PACK_REASON.ENGINE_ERROR}: ${engineFault}`;
  if (engineSkip === PACK_REASON.NO_CRS_RESULT) return PACK_REASON.NO_CRS_RESULT;
  return reason;
}

export async function buildLetterPackForClient(
  db,
  { clientId, pack = "funding" } = {},
  { runEngine = runTierEngineFromCrsResult } = {}
) {
  if (!clientId) {
    return { files: [], reason: PACK_REASON.NO_CLIENT, deliverableCount: 0, engineSkip: "no_client", engineOutcome: null };
  }
  let row;
  try {
    const client = await db.query(
      `SELECT first_name, last_name, custom_fields, outcome_tier FROM clients WHERE id = $1`,
      [clientId]
    );
    row = client.rows[0];
  } catch (err) {
    return {
      files: [],
      reason: PACK_REASON.NO_CLIENT,
      deliverableCount: 0,
      engineSkip: String(err && err.message || err).slice(0, 240),
      engineOutcome: null
    };
  }
  if (!row) {
    return { files: [], reason: PACK_REASON.NO_CLIENT, deliverableCount: 0, engineSkip: "no_client", engineOutcome: null };
  }
  const personal = personalFromClient(row);
  let engine = null;
  let storedCrs = null;
  let engineSkip = null;
  // engineFault mirrors engineSkip but is set only on a throw, so the reason
  // logic can tell a broken pull apart from a client who simply has no pull yet.
  let engineFault = null;
  try {
    const crs = await db.query(
      `SELECT result FROM crs_results WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [clientId]
    );
    if (!crs.rows[0]?.result) engineSkip = PACK_REASON.NO_CRS_RESULT;
    else {
      storedCrs = crs.rows[0].result;
      try {
        engine = runEngine(storedCrs, {
          submittedName: personal.name,
          submittedAddress: personal.address
        });
      } catch (err) {
        engineFault = String(err && err.message || err).slice(0, 240);
        engineSkip = engineFault;
      }
    }
  } catch (err) {
    engineFault = String(err && err.message || err).slice(0, 240);
    engineSkip = engineFault;
  }
  // The confirmed bureau answers this client already has on file. Read-only, and
  // a failure is reported rather than thrown: the worst a hiccup here may cost
  // is an escalation, never the client's Round 1 letters.
  const prior = await loadPriorOutcomes(db, { clientId });
  try {
    const packOut = await buildLetterPack({
      crsResult: engine,
      personal,
      pack,
      storedCrs,
      priorOutcomes: prior.outcomes,
      // outcome_tier was already on the row this function reads and had never
      // been used. It is the offer path the owner rule turns on.
      onRepairPath: REPAIR_PATH_TIERS.has(String(row.outcome_tier || ""))
    });
    return {
      ...packOut,
      reason: sharpenEmptyReason(packOut.reason, { engineSkip, engineFault }),
      engineSkip,
      engineOutcome: engine?.outcome ?? null,
      priorOutcomeSkip: prior.skip
    };
  } catch (err) {
    return {
      files: [],
      reason: PACK_REASON.PACK_ERROR,
      deliverableCount: 0,
      engineSkip: engineSkip || String(err && err.message || err).slice(0, 240),
      engineOutcome: engine?.outcome ?? null
    };
  }
}

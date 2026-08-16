// Three bureau reports in, ONE stored payload out.
//
// WHY ONE ROW AND NOT THREE. `crs_results` is the record of a pull, and a
// tri-bureau prequal is one pull that asked three questions. Writing a row per
// bureau would make "the client's latest credit result" a query with a tie to
// break, and every reader in this repo — triMerge, toBureaus, the inquiry gate,
// the sales cockpit — is written against one row.
//
// SHAPED FOR THE READERS THAT ALREADY EXIST, NOT FOR ITS OWN ELEGANCE:
//
//   tradelines[]   top level, because src/tradelines/index.mjs looks for a
//                  top-level `tradelines` container and will not go hunting.
//   scores{ex,eq,tu}  the key names triMerge and toBureaus already read.
//   inquiries[]    each carrying `source` as a bureau CODE, because
//                  src/inquiry-ops/extract-disputables.mjs reads `source` and
//                  would not recognise the vendor's `sourceType`.
//   bureaus{}      the full per-bureau report, unflattened, so nothing this
//                  mapper failed to understand is lost.
//
// WHAT IT REFUSES TO DO. It does not decide an outcome tier, it does not score
// the client, and it does not reconcile the same account appearing on two
// bureaus beyond the vendor's own account identifier. See DEDUPLICATION below —
// that limit is a known gap, recorded rather than papered over.

import { parseBureaus } from "../lenders/match.mjs";
import { maskSsn } from "../pii/index.mjs";

/** Bureau codes, in the order a merged payload lists them. */
export const BUREAU_CODES = Object.freeze(["TU", "EX", "EQ"]);

const SCORE_KEY = Object.freeze({ TU: "tu", EX: "ex", EQ: "eq" });

/* bureauOf — the vendor's `sourceType` ("TransUnion") → a bureau code ("TU").
   parseBureaus already owns every spelling of a bureau name in this repo, so
   this reuses it rather than starting a second list that can disagree. */
export function bureauOf(sourceType) {
  const codes = parseBureaus(sourceType);
  return codes.find((c) => BUREAU_CODES.includes(c)) || null;
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function asInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).trim());
  return Number.isInteger(n) ? n : null;
}

function isoDate(value) {
  const s = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Bureau-refused the file (E4000 invalid DOB, etc.). Not a score. */
export function bureauHardErrors(report) {
  const msgs = asArray(report?.errorMessages)
    .map((m) => {
      const code = String(m?.creditErrorMessageCode || "").trim();
      const text = String(m?.creditErrorMessageText || "").trim();
      if (!code && !text) return null;
      return [code, text].filter(Boolean).join(" ");
    })
    .filter(Boolean);
  return msgs.length ? msgs.join("; ") : null;
}

/**
 * pickCreditScore — the credit score out of a bureau's `scores` array.
 *
 * A bureau returns several models and only some of them are credit scores. The
 * sandbox's TransUnion file carries FICO 9 twice AND a "CreditVision Income
 * Estimator" whose scoreValue is the string "47 B"; Experian carries its FICO 9
 * equivalent plus an "Income Insight".
 *
 * THE FILTER IS READ OFF THE DATA, NOT INVENTED. In every sample the vendor
 * ships, exactly the credit-score models carry BOTH an integer scoreValue and an
 * integer scoreMaximumValue; the income estimators carry a null maximum and a
 * non-numeric value. So: keep the entries that have both, then prefer a model
 * whose name says FICO or Fair Isaac.
 *
 * The fallback matters because Equifax's model name is not in any sample this
 * repo has seen. Rather than guess the string, an unnamed-but-numerically-valid
 * score is accepted AND the model name is recorded alongside it, so a human can
 * confirm what was read instead of trusting that it was right.
 */
export function pickCreditScore(scores) {
  const rows = asArray(scores).map((s) => ({
    value: asInt(s?.scoreValue),
    max: asInt(s?.scoreMaximumValue),
    model: String(s?.modelName ?? "").trim()
  }));

  /* FICO / Fair Isaac wins even when the bureau omits scoreMaximumValue.
     Equifax live files do that, and the old "must have a max" filter then
     picked IncomeView (81) over FICO 9. */
  const fico = rows.find((s) =>
    s.value !== null && s.value >= 300 && s.value <= 850 && /fico|fair\s*isaac/i.test(s.model)
  );
  if (fico) return { value: fico.value, model: fico.model || null };

  const candidates = rows.filter((s) => s.value !== null && s.max !== null && s.value >= 300 && s.value <= 850);
  if (!candidates.length) return { value: null, model: null };
  return { value: candidates[0].value, model: candidates[0].model || null };
}

/* redactRequestEcho — CRS echoes the identity it was asked about, SSN included,
   back inside every report.

   That echo is stored verbatim unless something removes it, and `crs_results`
   is not an encrypted column: this repo keeps full SSNs in `pii_identity`,
   encrypted, precisely so that no second plaintext copy exists. Storing the
   bureau's echo would quietly create one. The last four survive, which is all
   any screen or reconciliation needs. */
function redactRequestEcho(report) {
  const echo = report?.requestData;
  if (!echo || typeof echo !== "object") return report;
  const { ssn, ...rest } = echo;
  return {
    ...report,
    requestData: { ...rest, ssnLast4: maskSsn(ssn), ssnRedacted: true }
  };
}

/**
 * mergeBureauReports — the whole job.
 *
 * @param {object} input
 * @param {object} input.reports        { TU?: report, EX?: report, EQ?: report }
 * @param {object} [input.errors]       { EQ: "why it failed" }
 * @param {object} [input.requestIds]   { TU: "..." } — the vendor's own ids
 * @param {string} [input.environment]  "sandbox" | "production"
 * @param {string} [input.pulledAt]     ISO timestamp
 */
export function mergeBureauReports({
  reports = {},
  errors = {},
  requestIds = {},
  environment = null,
  pulledAt = new Date().toISOString()
} = {}) {
  const scores = { ex: null, eq: null, tu: null };
  const scoreModels = { ex: null, eq: null, tu: null };
  const tradelines = [];
  const inquiries = [];
  const publicRecords = [];
  const bureaus = {};
  const bureausPulled = [];

  for (const code of BUREAU_CODES) {
    const report = reports[code];
    if (!report || typeof report !== "object") continue;

    bureausPulled.push(code);
    bureaus[code] = redactRequestEcho(report);

    const hard = bureauHardErrors(report);
    if (hard && !errors[code]) errors[code] = hard;

    const { value, model } = pickCreditScore(report.scores);
    scores[SCORE_KEY[code]] = value;
    scoreModels[SCORE_KEY[code]] = model;

    /* DEDUPLICATION, AND WHERE IT STOPS.
       Every bureau's lines are carried through. Where two bureaus report the
       same `accountIdentifier`, the unique index on (client_id, account_ref)
       collapses them on ingest — that is the vendor's own identifier agreeing
       with itself, not a guess.
       Where the identifiers DIFFER, both lines survive as separate tradelines,
       even if they are the same physical card. Matching them would take a
       heuristic on creditor name, open date and limit, and a wrong match either
       hides a real account or invents available credit — both of which move a
       funding number. Nobody has decided that rule, so this mapper does not
       invent one. Recorded as an open question on the workflow board. */
    for (const line of asArray(report.tradelines)) {
      if (line && typeof line === "object") tradelines.push(line);
    }

    for (const inq of asArray(report.inquiries)) {
      if (!inq || typeof inq !== "object") continue;
      inquiries.push({
        ...inq,
        // `source` as a bureau CODE: what extract-disputables reads. The
        // vendor's own sourceType is left in place beside it.
        source: bureauOf(inq.sourceType) || code,
        date: isoDate(inq.inquiryDate)
      });
    }

    for (const rec of asArray(report.publicRecords)) {
      if (rec && typeof rec === "object") publicRecords.push({ ...rec, source: code });
    }
  }

  return {
    source: "crs",
    product: "prequal-fico9",
    environment,
    pulledAt,

    // Both spellings on purpose: the underscored one is the format
    // parseBureaus() consumes elsewhere in this repo, the array is what code
    // reads without parsing.
    bureausPulled,
    bureaus_pulled: bureausPulled.join("/"),

    scores,
    scoreModels,

    tradelines,
    inquiries,
    publicRecords,

    // Per-bureau, whole and unflattened. Anything this mapper did not
    // understand is still here.
    bureaus,

    // A bureau that failed is a fact about the pull, kept beside the ones that
    // worked. An empty object means all three answered.
    bureauErrors: { ...errors },
    requestIds: { ...requestIds }
  };
}

/**
 * newInquiriesFor — the `{ bureau, inquiry }` pairs the analysis.completed
 * payload carries. Same shape src/adapters/crs.mjs already emits, so the
 * downstream handlers do not learn a second one.
 */
export function newInquiriesFor(merged) {
  return asArray(merged?.inquiries)
    .filter((i) => i && i.source && i.creditorName)
    .map((i) => ({ bureau: i.source, inquiry: i.creditorName, date: i.date ?? null }));
}

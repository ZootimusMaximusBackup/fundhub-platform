#!/usr/bin/env node
// scripts/sim/push-credit.mjs — put a simulated credit file on an EXISTING client.
//
//   DATABASE_URL=… INNGEST_EVENT_KEY=… node scripts/sim/push-credit.mjs \
//     --email stanbridgejchris+sim-01@gmail.com --profile funding [--dry]
//
// For the manual walkthrough (docs/workflows/manual-walkthrough-SOP.md). Chris
// opts a simulated client in through ClickFunnels; this puts the credit report
// behind that client WITHOUT touching the bureau — no CRS call, no $32, no
// inquiry on anyone's file. Everything downstream of a real pull still runs:
// the crs_results row, tradelines, card liabilities, the REAL tier engine, and
// the two events (analysis.completed, decision.rendered) that move the card and
// stamp the tier, exactly as src/finance/crs-pull.mjs does after a vendor call.
//
// The payload is stamped `environment: "simulated"` + `simulated: true`, the
// same marks src/demo/simulate-client.mjs and crs-pull's rehearsal mode use, so
// every screen and event can tell it was never a bureau pull. The client row is
// NOT flagged is_demo — these clients must show on every dashboard like a real
// one, because that is what is being tested.
//
// Profiles are shaped for the path being walked (see PROFILES). The tier engine
// decides the outcome; nothing here forces a tier.

import { pool, close } from "../../src/db.mjs";
import { resolveDefaultOrg } from "../../src/auth/org.mjs";
import { ensureRegistered } from "../../src/register-all.mjs";
import { emit } from "../../src/events/bus.mjs";
import { ingestCrsResult } from "../../src/tradelines/store.mjs";
import { ingestCrsLiabilities } from "../../src/liabilities/store.mjs";
import { mergeCustomFields } from "../../src/workflows/custom-fields.mjs";
import { runTierEngineFromCrsResult } from "../../src/finance/crs-tier.mjs";
import { newInquiriesFor } from "../../src/finance/crs-map.mjs";

const BUREAU_NAME = { EX: "Experian", EQ: "Equifax", TU: "TransUnion" };

/* One account, in the VENDOR's field names (vendor/underwriteiq-full/api/lite/crs/
   sandbox/tu.json is the reference) plus the two repo spellings the tradeline
   ingest reads (src/tradelines/index.mjs). The tier engine normalises the vendor
   keys: accountOwnershipType decides primary vs authorized user,
   accountStatusType decides open, currentRatingType + derogatoryDataIndicator +
   _30DayLates decide clean vs dirty (derive-consumer-signals.js). */
const RATING = {
  current: { currentRatingType: "AsAgreed", derogatoryDataIndicator: false, _30: "0", _60: "0", _90: "0", pastDue: "0", pattern: "CCCCCCCCCCCCCCCCCCCCCCCC" },
  late30: { currentRatingType: "Late30Days", derogatoryDataIndicator: true, _30: "2", _60: "0", _90: "0", pastDue: "185", pattern: "1CC1CCCCCCCCCCCCCCCCCCCC" },
  collection: { currentRatingType: "CollectionOrChargeOff", derogatoryDataIndicator: true, _30: "0", _60: "0", _90: "0", pastDue: "0", pattern: "" },
  chargeoff: { currentRatingType: "ChargeOff", derogatoryDataIndicator: true, _30: "1", _60: "1", _90: "3", pastDue: "0", pattern: "9999999321CCCCCCCCCCCCCC" }
};
const VENDOR_TYPE = { revolving: ["Revolving", "CreditCard"], installment: ["Installment", "Auto"], collection: ["Open", "CollectionAgencyAttorney"] };

/* Which bureaus an account reports to. A real damaged file is lopsided — a
   collection agency furnishes to the two bureaus it has a contract with, not
   always all three — and several dispute strategies turn on that difference.
   Clean, seasoned accounts do normally report to all three, so CLEAN keeps the
   default and only the derogatory lines below name a subset. */
const ALL_BUREAUS = Object.freeze(["EX", "EQ", "TU"]);

function line({ creditor, kind, limit, balance, apr, ref, opened, status = "current", bureaus = ALL_BUREAUS }) {
  const r = RATING[status];
  const [accountType, loanType] = VENDOR_TYPE[kind];
  return {
    bureaus,
    // vendor spellings — what the tier engine reads
    creditorName: creditor,
    accountIdentifier: ref,
    accountOpenedDate: opened,
    accountReportedDate: "2026-08-28",
    lastActivityDate: "2026-08-20",
    accountOwnershipType: "Individual",
    accountStatusType: "Open",
    accountType,
    loanType,
    borrowerSourceType: "Borrower",
    businessType: kind === "collection" ? "Collection" : "Banking",
    derogatoryDataIndicator: r.derogatoryDataIndicator,
    currentRatingType: r.currentRatingType,
    currentRatingCode: r.currentRatingType === "AsAgreed" ? "C" : "9",
    creditLimitAmount: String(limit),
    highBalanceAmount: String(Math.max(limit, balance)),
    currentBalanceAmount: String(balance),
    pastDueAmount: r.pastDue,
    monthsReviewedCount: "24",
    _30DayLates: r._30, _60DayLates: r._60, _90DayLates: r._90,
    paymentPatternData: r.pattern,
    paymentPatternStartDate: "2026-08-01",
    // repo spellings — what src/tradelines/index.mjs and the liabilities ingest read
    currentBalance: String(balance),
    apr: String(apr),
    account_ref: ref,
    paymentStatus: status === "current" ? "current" : (status === "late30" ? "30 days late" : status === "collection" ? "collection" : "charge-off"),
    kind
  };
}

/* Account identifiers carry FOUR digits at the end on purpose. The system reads
   the last four DIGITS off this string (src/metro2/normalize.mjs lastFour), and
   the old "SIM-MCM-001" endings held only three, so every simulated account had
   no account number at all: letters could not say "ending 1234", cross-bureau
   matching (creditor + last four) could never fire, and a bureau's written reply
   could not be matched back to the account it was about. The endings are also
   distinct from each other, so two accounts never collapse into one. */
const CLEAN = [
  line({ creditor: "Chase Sapphire Preferred", kind: "revolving", limit: 12000, balance: 2100, apr: 22.24, ref: "SIM-CHASE-8814", opened: "2019-04-12" }),
  line({ creditor: "American Express Blue Business Cash", kind: "revolving", limit: 25000, balance: 4800, apr: 18.49, ref: "SIM-AMEX-2007", opened: "2020-08-01" }),
  line({ creditor: "Capital One Spark", kind: "revolving", limit: 8000, balance: 950, apr: 24.99, ref: "SIM-CAP1-5163", opened: "2021-01-20" }),
  line({ creditor: "Toyota Motor Credit", kind: "installment", limit: 28000, balance: 14200, apr: 5.9, ref: "SIM-TOYO-4490", opened: "2022-06-15" })
];

/* The two collections and the charge-off report to two bureaus each, not three.
   That is what a real damaged file looks like, and it is what lets the per-bureau
   letters differ from one another. The two bank cards stay on all three. */
const DAMAGED = [
  line({ creditor: "Capital One Platinum", kind: "revolving", limit: 3000, balance: 2870, apr: 29.99, ref: "SIM-CAP1-7729", opened: "2021-03-02", status: "late30" }),
  line({ creditor: "Credit One Bank", kind: "revolving", limit: 1500, balance: 1490, apr: 31.49, ref: "SIM-CRED1-3018", opened: "2022-09-14" }),
  line({ creditor: "Midland Credit Management", kind: "collection", limit: 0, balance: 1840, apr: 0, ref: "SIM-MCM-6642", opened: "2024-02-20", status: "collection", bureaus: ["EX", "TU"] }),
  line({ creditor: "Portfolio Recovery Associates", kind: "collection", limit: 0, balance: 960, apr: 0, ref: "SIM-PRA-9075", opened: "2024-07-08", status: "collection", bureaus: ["EQ", "TU"] }),
  line({ creditor: "Synchrony Bank / Care Credit", kind: "revolving", limit: 2500, balance: 2500, apr: 26.99, ref: "SIM-SYNC-1256", opened: "2020-11-30", status: "chargeoff", bureaus: ["EX", "EQ"] })
];

const INQ = (list) => list.map(([creditor, bureau, date]) => ({ creditorName: creditor, bureau, date }));

/* Shaped for the path. Scores in FICO 9 points. Negatives are counted from the
   lines, never typed twice. */
export const PROFILES = Object.freeze({
  funding: {
    note: "Path 1 — clean 700s file, seasoned lines, seven recent inquiries. Should tier for funding.",
    scores: { EX: 718, EQ: 724, TU: 731 },
    lines: CLEAN,
    inquiries: INQ([["Chase Bank USA NA", "EX", "2025-11-14"], ["Discover Financial Svcs", "EX", "2026-01-08"], ["US Bank NA", "EX", "2026-02-27"], ["Amex Membership Banking", "EX", "2026-04-03"], ["Barclays Bank Delaware", "EQ", "2025-12-19"], ["Citibank NA", "EQ", "2026-03-11"], ["Navy Federal CU", "TU", "2026-05-22"]]),
    businessAgeMonths: 30
  },
  repair: {
    note: "Path 2 — high-500s file, two collections, one charge-off, one late. Should route to repair.",
    scores: { EX: 588, EQ: 602, TU: 595 },
    lines: DAMAGED,
    inquiries: INQ([["Capital One", "EX", "2026-02-11"], ["Credit One", "EQ", "2026-03-02"]]),
    businessAgeMonths: 18
  },
  trial: {
    note: "Path 3 — low-600s, one collection and one charge-off. Personal funding only.",
    scores: { EX: 612, EQ: 620, TU: 609 },
    lines: [CLEAN[2], DAMAGED[2], DAMAGED[4]],
    inquiries: INQ([["Discover Financial Svcs", "TU", "2026-04-19"]]),
    businessAgeMonths: 0
  },
  blueprint: {
    note: "Path 4 — mid-600s, thin clean file. The education/roadmap buyer.",
    scores: { EX: 655, EQ: 668, TU: 661 },
    lines: [CLEAN[0], CLEAN[2]],
    inquiries: INQ([["Chase Bank USA NA", "EX", "2026-05-30"], ["Wells Fargo Bank", "TU", "2026-06-12"]]),
    businessAgeMonths: 9
  },
  academy: {
    note: "Path 5 — 750s, clean, no inquiries. Premium buyer.",
    scores: { EX: 762, EQ: 770, TU: 758 },
    lines: CLEAN,
    inquiries: [],
    businessAgeMonths: 72
  }
});

function bureauReport(code, profile, { infileDate }) {
  const sourceType = BUREAU_NAME[code];
  /* The file date is the day the file was compiled. It was hardcoded to
     2019-01-15 while every account on it reported 2026-08-28 — seven years in
     the FUTURE relative to the file. The stale-reporting rule measures the gap
     between the two, and a negative gap can never fire. It is now the pull date,
     so the file is internally consistent. */
  return {
    repositoryIncluded: { transunion: code === "TU", experian: code === "EX", equifax: code === "EQ" },
    responseAlertMessages: [],
    creditFiles: [{
      creditFileDetail: { borrowerSourceType: "Borrower", sourceType, creditFileResultStatusType: "FileReturned", creditFileInfileDate: infileDate },
      aliases: [], ssns: [], employments: [], addresses: []
    }],
    scores: [{
      borrowerSourceType: "Borrower", modelName: "FICO® Score 9", modelNameType: "00W18", sourceType,
      scoreValue: String(profile.scores[code]), scoreMaximumValue: "850", scoreMinimumValue: "300", factaInquiriesIndicator: false, scoreFactors: []
    }],
    /* Only the accounts that actually furnish to THIS bureau. Copying the whole
       list into all three made every account appear everywhere, which no real
       damaged file does and which the letter engine reads directly. */
    tradelines: profile.lines
      .filter((t) => (t.bureaus || ALL_BUREAUS).includes(code))
      .map((t) => ({ ...t, sourceType, bureau: code })),
    inquiries: profile.inquiries.filter((i) => i.bureau === code).map((i) => ({
      creditorName: i.creditorName, borrowerSourceType: "Borrower", inquiryDate: i.date, businessType: "Banking", subscriberCode: "SIM", sourceType
    })),
    publicRecords: []
  };
}

export function buildPayload(profileKey, { email, name, pulledAt = new Date().toISOString() }) {
  const p = PROFILES[profileKey];
  if (!p) throw new Error(`unknown profile ${profileKey}; one of ${Object.keys(PROFILES).join("|")}`);
  const infileDate = String(pulledAt).slice(0, 10);
  const scores = { ex: p.scores.EX, eq: p.scores.EQ, tu: p.scores.TU };
  /* `accountType` is the VENDOR spelling and the vendor capitalises it —
     "Revolving", not "revolving". Matching lower case matched nothing, so the
     stored card-use figure was always 0% and the stored total limit counted the
     car loan as if it were a credit line. Both numbers are read straight onto
     the screen, so both were wrong and flattering. */
  const isCard = (t) => t.accountType === "Revolving";
  const bal = p.lines.filter(isCard).reduce((n, t) => n + Number(t.currentBalanceAmount || 0), 0);
  const revLimit = p.lines.filter(isCard).reduce((n, t) => n + Number(t.creditLimitAmount || 0), 0);
  const utilization = revLimit ? Math.round((bal / revLimit) * 100) : 0;
  /* Total CREDIT limit — cards only. An installment loan has a balance, not a limit. */
  const limit = revLimit;
  return {
    source: "crs",
    product: "prequal-fico9",
    environment: "simulated",
    simulated: true,
    simulatedNotice: "SIMULATED — manual walkthrough 2026-09-03. Not a bureau pull.",
    pulledAt,
    bureausPulled: ["TU", "EX", "EQ"],
    bureaus_pulled: "TU/EX/EQ",
    scores,
    scoreModels: { ex: "FICO 9", eq: "FICO 9", tu: "FICO 9" },
    /* One row per account for the tradeline ingest, stamped with the first bureau
       that actually reports it rather than a round-robin that ignored the file. */
    tradelines: p.lines.map((t) => {
      const code = (t.bureaus || ALL_BUREAUS)[0];
      return { ...t, bureau: code, sourceType: BUREAU_NAME[code] };
    }),
    inquiries: p.inquiries.map((i) => ({
      creditorName: i.creditorName, sourceType: BUREAU_NAME[i.bureau], inquiryDate: i.date, source: i.bureau, date: i.date
    })),
    publicRecords: [],
    bureaus: {
      TU: bureauReport("TU", p, { infileDate }),
      EX: bureauReport("EX", p, { infileDate }),
      EQ: bureauReport("EQ", p, { infileDate })
    },
    bureauErrors: {},
    requestIds: { TU: "simulated-TU", EX: "simulated-EX", EQ: "simulated-EQ" },
    consumerSignals: { scores: { perBureau: { ...scores } }, utilization: { pct: utilization } },
    crm_payload: {
      contact: { email: email || null, name: name || null },
      scores: { ...scores },
      customFields: { crs_utilization: utilization, crs_total_limit: limit }
    }
  };
}

function countNegatives(lines) {
  return lines.filter((t) => t.derogatoryDataIndicator === true).length;
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

async function main() {
  const email = String(arg("email", "")).trim().toLowerCase();
  const profileKey = String(arg("profile", "")).trim();
  const dry = process.argv.includes("--dry");
  if (!email || !profileKey) {
    console.error("usage: node scripts/sim/push-credit.mjs --email <client email> --profile funding|repair|trial|blueprint|academy [--dry]");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(2); }
  const db = pool();
  ensureRegistered();

  const orgId = await resolveDefaultOrg(db);
  const c = (await db.query(
    `SELECT id, first_name, last_name, email, outcome_tier FROM clients WHERE org_id = $1 AND lower(email) = $2 ORDER BY created_at DESC LIMIT 1`,
    [orgId, email]
  )).rows[0];
  if (!c) { console.error(`no client with email ${email} in the default company — opt in through ClickFunnels first`); process.exit(1); }
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ");

  const prior = (await db.query(`SELECT count(*)::int AS n FROM crs_results WHERE client_id = $1`, [c.id])).rows[0].n;
  const p = PROFILES[profileKey];
  const payload = buildPayload(profileKey, { email, name });

  // The real tier engine decides. Nothing here forces an outcome.
  const tier = runTierEngineFromCrsResult(payload, {
    submittedName: name,
    submittedAddress: "",
    formData: { name, email, phone: null }
  });
  payload.outcome = tier.outcome;
  payload.preapprovals = tier.preapprovals ?? null;
  payload.reason_codes = tier.reasonCodes ?? tier.reason_codes ?? ["simulated"];
  const fundingEstimate = tier.preapprovals?.totalCombined ?? null;

  console.log(`client   ${name} <${email}> id=${c.id}`);
  console.log(`profile  ${profileKey} — ${p.note}`);
  console.log(`scores   EX ${p.scores.EX} · EQ ${p.scores.EQ} · TU ${p.scores.TU} · ${p.lines.length} lines · ${p.inquiries.length} inquiries · ${countNegatives(p.lines)} negatives`);
  console.log(`tier     ${tier.outcome} · funding estimate ${fundingEstimate ?? "none"}`);
  /* Say it out loud so the walkthrough is not surprised by a $0 business figure. */
  console.log(`business $0 — no business credit report is passed, so business_age_months ${p.businessAgeMonths} is never read`);
  console.log(`prior    ${prior} crs_results row(s) already on this client${prior ? " — a new one is added, the newest wins" : ""}`);
  if (dry) { console.log("dry run — nothing written"); await close(); return; }

  const crs = (await db.query(
    `INSERT INTO crs_results (org_id, client_id, result, outcome_tier) VALUES ($1, $2, $3::jsonb, $4) RETURNING *`,
    [orgId, c.id, JSON.stringify(payload), tier.outcome]
  )).rows[0];
  const ingested = await ingestCrsResult(db, crs);
  const liabilities = await ingestCrsLiabilities(db, crs);

  const inqCount = (code) => p.inquiries.filter((i) => i.bureau === code).length;
  await mergeCustomFields(db, c.id, {
    crs_inquiries_ex: inqCount("EX"),
    crs_inquiries_eq: inqCount("EQ"),
    crs_inquiries_tu: inqCount("TU"),
    crs_negative_items_count: countNegatives(p.lines),
    crs_late_payments_count: p.lines.filter((t) => /late/i.test(String(t.paymentStatus))).length,
    /* DISPLAY ONLY. The funding estimator never reads this. Business money is
       blocked at $0 unless a real BUSINESS CREDIT REPORT is passed to the engine
       (estimate-preapprovals.js: `businessAvailable = bs?.available === true`),
       and the age multiplier is only reached after that check passes. The sim
       passes no business report, so the business half of every estimate here is
       $0 and this 30 months is never consulted. Pinned by
       src/underwrite/preapproval-modifiers.test.mjs. */
    business_age_months: p.businessAgeMonths,
    crs_utilization: payload.consumerSignals.utilization.pct
  });

  const stamp = { simulated: true, simulatedNotice: payload.simulatedNotice };
  const requestId = `sim-walkthrough:${crs.id}`;
  await emit(db, "analysis.completed", {
    crsResultId: crs.id, requestId, source: "crs",
    // `newInquiries` — the key c-02-inquiry-created reads. Emitting `inquiries`
    // here meant the sim's inquiries were never logged either.
    scores: payload.scores, bureaus: payload.bureaus, newInquiries: newInquiriesFor(payload),
    outcomeTier: tier.outcome, ...stamp
  }, { orgId, clientId: c.id, idempotencyKey: `crs-result:${crs.id}:analysis.completed:v1` });
  await emit(db, "decision.rendered", {
    crsResultId: crs.id, requestId, source: "crs",
    outcomeTier: tier.outcome, fundingEstimate, ...stamp
  }, { orgId, clientId: c.id, idempotencyKey: `crs-result:${crs.id}:decision.rendered:v1` });

  const after = (await db.query(`SELECT outcome_tier, custom_fields->>'total_funding_estimate' AS est FROM clients WHERE id = $1`, [c.id])).rows[0];
  void ingested; void liabilities;
  const counts = (await db.query(
    `SELECT (SELECT count(*) FROM tradelines WHERE client_id = $1)::int AS lines,
            (SELECT count(*) FROM card_liabilities WHERE client_id = $1)::int AS liabilities`, [c.id])).rows[0];
  console.log(`written  crs_results ${crs.id} · ${counts.lines} tradelines · ${counts.liabilities} liabilities on the client`);
  console.log(`client   outcome_tier=${after.outcome_tier} total_funding_estimate=${after.est ?? "none"}`);
  console.log("events   analysis.completed + decision.rendered emitted (card advances to Decision rendered)");
  await close();
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(async (e) => { console.error(e); try { await close(); } catch { /* noop */ } process.exit(1); });
}

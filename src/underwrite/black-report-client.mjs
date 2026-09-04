// Map UnderwriteIQ / CRS engine output into the CLIENT dict that
// scripts/black-reports/fundhub_gen.py expects.
//
// Absence stays empty. No Jordan Sample leftovers. No invented scores,
// balances, lenders, or personal facts.
// COMPLIANCE REVIEW REQUIRED — credit-repair / projected-score adjacent.

import { createRequire } from "node:module";
import { salesMeetBookingUrl } from "../insights/meet.mjs";

const require = createRequire(import.meta.url);
const { matchLenders } = require("../../vendor/underwriteiq-full/api/lite/crs/lender-matrix.js");

const BUREAU_LABEL = Object.freeze({
  experian: "Experian",
  equifax: "Equifax",
  transunion: "TransUnion"
});

const BUREAU_KEYS = Object.freeze(["experian", "equifax", "transunion"]);

export function emptyBlackReportClient() {
  return {
    applicant: "",
    date: "",
    outcome: "",
    address: "",
    state: "",
    llc_fee: null,
    booking_url: "",
    scores: {},
    score_targets: { experian: "", equifax: "", transunion: "", median: "" },
    preapproval_now: null,
    preapproval_after: null,
    bureaus: [],
    revolving: [],
    util_total_balance: null,
    util_total_limit: null,
    util_pct: "",
    util_target_balance: null,
    au_account: { creditor: "", bureau: "", limit: null, balance: null, util: "", age: "" },
    negatives: [],
    inquiries: [],
    inquiry_total: 0,
    personal_data: [],
    installments: [],
    mortgages: [],
    public_obligations: [],
    lenders: [],
    /* F45. The vendor matcher already splits its answer in two and this file
       used to flatten both halves into one list, which is why every lender
       landed under "After optimization" and nothing under "Available right
       now". The split is kept from here on. `lenders` stays as it was — the
       WeasyPrint template reads it — and these two carry the buckets. */
    lenders_now: [],
    lenders_after: [],
    /* The reference's score ladder: how many points away each locked lender is. */
    score_ladder: [],
    /* What the engine's own optimization findings say is costing this client
       money, and what it says does NOT affect funding. The words are the
       vendor engine's, already written at a 5th grade reading level; nothing
       here authors a new claim about credit outcomes. */
    costing_you: [],
    not_a_factor: [],
    strategy: [],
    /* F44. Whether this client has a company on file at all, and how old it is.
       Owner rule (F15, 2026-09-03, ../underwrite/business-funding.mjs): no
       company row, no business. This is display only — the business half of the
       funding estimate is gated on a real BUSINESS CREDIT REPORT in the vendor
       estimator and nothing here moves that. */
    business: { hasEntity: false, ageMonths: null, name: "" }
  };
}

function finiteNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function bureauSource(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "ex" || s === "experian") return "experian";
  if (s === "eq" || s === "equifax") return "equifax";
  if (s === "tu" || s === "transunion") return "transunion";
  return s;
}

function scoresFromEngine(crsResult) {
  const per = crsResult?.consumerSignals?.scores?.perBureau || {};
  const top = crsResult?.scores || {};
  const out = {};
  const ex = finiteNumber(per.ex ?? top.ex ?? top.experian);
  const eq = finiteNumber(per.eq ?? top.eq ?? top.equifax);
  const tu = finiteNumber(per.tu ?? top.tu ?? top.transunion);
  if (ex != null) out.experian = Math.round(ex);
  if (eq != null) out.equifax = Math.round(eq);
  if (tu != null) out.transunion = Math.round(tu);
  return out;
}

/** True when the printer has all three bureau scores. Missing scores are not invented. */
export function hasBlackReportSource(crsResult) {
  if (!crsResult || typeof crsResult !== "object") return false;
  const scores = scoresFromEngine(crsResult);
  return BUREAU_KEYS.every((k) => Number.isFinite(scores[k]));
}

function normalizeTradeline(t) {
  if (!t || typeof t !== "object") return null;
  const source = bureauSource(t.source || t.bureau);
  const status = String(t.status || t.paymentStatus || "").toLowerCase();
  const rating = t.currentRatingType || t.paymentStatus || "";
  const derog = !!(t.isDerogatory || t.is_negative)
    || /charge|collect|late|derog/i.test(String(rating));
  return {
    ...t,
    source,
    creditorName: t.creditorName || t.creditor || "",
    accountType: t.accountType || t.account_type || "",
    status: t.status || t.paymentStatus || "",
    isDerogatory: derog,
    isAU: !!(t.isAU || t.is_au),
    currentBalance: t.currentBalance ?? t.currentBalanceAmount ?? t.balance ?? null,
    effectiveLimit: t.effectiveLimit ?? t.creditLimitAmount ?? t.creditLimit ?? t.limit ?? null,
    openedDate: t.openedDate || t.accountOpenedDate || t.dateOpened || null,
    currentRatingType: t.currentRatingType || t.paymentStatus || null
  };
}

function tradelinesOf(crsResult) {
  const fromNorm = crsResult?.normalized?.tradelines;
  const fromTop = crsResult?.tradelines;
  const list = Array.isArray(fromNorm) && fromNorm.length
    ? fromNorm
    : (Array.isArray(fromTop) ? fromTop : []);
  return list.map(normalizeTradeline).filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════════════════
// F43 — ONE ACCOUNT, ONE ROW
//
// A tri-merge report is THREE reports. An account that furnishes to all three
// bureaus arrives here three times, and until now nothing merged them: the
// printed documents showed nine card rows for three cards, three Toyota loans
// for one car, and totals three times the truth ($23,550 of balance against
// $135,000 of limit, with a paydown target of $13,500 instead of $4,500).
//
// The merge happens HERE, in the display mapper, and never in the engine. Both
// sides of the utilisation fraction triple together, so the engine's percentage
// and therefore the client's tier and pre-approval are correct as they stand —
// collapsing accounts upstream would silently move a funding number. See the
// UWIQ spec section 5 #3, and CLAUDE.md section 12 on money.
//
// The key is the creditor plus the account identifier, because that is the pair
// the rest of the system already matches on across bureaus (../metro2/
// normalize.mjs lastFour). When a line carries no identifier the fallback adds
// account type, balance and limit, so two genuinely different accounts at one
// creditor stay two rows.
// ═══════════════════════════════════════════════════════════════════════════════

function accountKey(t) {
  const creditor = String(t?.creditorName || t?.creditor || "").trim().toLowerCase();
  const ref = String(t?.accountIdentifier || t?.accountId || t?.accountNumber || t?.account_ref || "").trim().toLowerCase();
  if (creditor && ref) return `${creditor}|${ref}`;
  return [
    creditor,
    accountTypeOf(t),
    String(finiteNumber(t?.currentBalance ?? t?.balance) ?? ""),
    String(finiteNumber(t?.effectiveLimit ?? t?.creditLimit ?? t?.limit) ?? ""),
    String(t?.openedDate || "")
  ].join("|");
}

/**
 * One row per real account, carrying every bureau it was seen on.
 * Order is preserved: the first sighting wins, later ones only add a bureau.
 */
export function dedupeTradelines(tradelines) {
  const byKey = new Map();
  for (const t of tradelines || []) {
    if (!t) continue;
    const key = accountKey(t);
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { ...t, sources: t.source ? [t.source] : [] });
      continue;
    }
    if (t.source && !seen.sources.includes(t.source)) seen.sources.push(t.source);
    // A bureau that reports the account as derogatory is the one that matters.
    if (t.isDerogatory) seen.isDerogatory = true;
  }
  return [...byKey.values()];
}

/** "Experian, Equifax" — every bureau this one account was found on. */
function bureauCell(t) {
  const list = (t?.sources && t.sources.length ? t.sources : [t?.source])
    .map(bureauLabel)
    .filter(Boolean);
  return list.length ? list.join(", ") : "";
}

function inquiriesOf(crsResult) {
  const fromNorm = crsResult?.normalized?.inquiries;
  const fromTop = crsResult?.inquiries;
  const list = Array.isArray(fromNorm) && fromNorm.length
    ? fromNorm
    : (Array.isArray(fromTop) ? fromTop : []);
  return list.map((i) => ({
    ...i,
    source: bureauSource(i.source || i.bureau),
    creditorName: i.creditorName || i.creditor || i.subscriber || "",
    date: i.date || i.inquiryDate || ""
  }));
}

function identityOf(crsResult) {
  const id = crsResult?.normalized?.identity;
  return id && typeof id === "object" ? id : {};
}

function publicRecordsOf(crsResult) {
  const list = crsResult?.normalized?.publicRecords;
  return Array.isArray(list) ? list : [];
}

function bureauLabel(source) {
  const key = String(source || "").toLowerCase();
  return BUREAU_LABEL[key] || "";
}

function accountTypeOf(t) {
  return String(t?.accountType || t?.account_type || "").toLowerCase();
}

function isClosed(t) {
  const status = String(t?.status || "").toLowerCase();
  return status.includes("close") || status.includes("paid") || status.includes("charge");
}

function utilPct(balance, limit) {
  if (balance == null || limit == null || limit <= 0) return null;
  return Math.round((balance / limit) * 100);
}

function utilStatus(t, pct) {
  if (isClosed(t)) return "CLOSED";
  if (pct == null) return "MONITOR";
  if (pct >= 80) return "CRITICAL";
  if (pct >= 50) return "HIGH";
  if (pct === 0) return "CLEAN";
  return "MONITOR";
}

function utilTarget(limit) {
  if (limit == null || limit <= 0) return "";
  return `${formatUsdPlain(Math.round(limit * 0.1))} or less`;
}

function monthsOpen(openedDate) {
  if (!openedDate) return "";
  const from = new Date(openedDate);
  if (Number.isNaN(from.getTime())) return "";
  const now = new Date();
  const months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  if (!Number.isFinite(months) || months < 0) return "";
  return `~${months} months`;
}

function formatUsdPlain(n) {
  if (n == null) return "";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function uniqueStrings(arr, pick) {
  const seen = new Set();
  const out = [];
  for (const row of arr || []) {
    const s = pick(row);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function formatIdentityName(n) {
  if (!n) return "";
  if (typeof n === "string") return n.trim();
  return n.full || n.display || [n.first, n.middle, n.last].filter(Boolean).join(" ").trim();
}

function formatAddress(a) {
  if (!a) return "";
  if (typeof a === "string") return a.trim();
  return [a.line1 || a.addressLine1, a.city, a.state, a.zip || a.postalCode].filter(Boolean).join(", ");
}

function mapBureaus(crsResult) {
  const negs = crsResult?.consumerSignals?.bureauNegatives || {};
  const rows = [];
  for (const key of BUREAU_KEYS) {
    const slice = negs[key];
    if (!slice?.pulled) continue;
    const count = Number.isFinite(slice.count) ? slice.count : (slice.items || []).length;
    const clean = !!slice.clean;
    rows.push([
      BUREAU_LABEL[key],
      clean ? "CLEAN" : "DIRTY",
      count,
      clean ? "No derogatory items." : `${count} negative item${count === 1 ? "" : "s"}.`
    ]);
  }
  if (rows.length) return rows;
  // Stored pulls often have scores but no bureauNegatives.pulled flag.
  const scores = scoresFromEngine(crsResult);
  const byBureau = { experian: 0, equifax: 0, transunion: 0 };
  /* One merged negative row can name more than one bureau (see mapNegatives),
     and each bureau it names carries that item on its own file. */
  for (const item of mapNegatives(crsResult, dedupeTradelines(tradelinesOf(crsResult)))) {
    for (const label of String(item.bureau || "").split(",")) {
      const key = bureauSource(label.trim());
      if (byBureau[key] != null) byBureau[key] += 1;
    }
  }
  for (const key of BUREAU_KEYS) {
    if (!Number.isFinite(scores[key])) continue;
    const count = byBureau[key];
    rows.push([
      BUREAU_LABEL[key],
      count ? "DIRTY" : "CLEAN",
      count,
      count ? `${count} negative item${count === 1 ? "" : "s"}.` : "No derogatory items."
    ]);
  }
  return rows;
}

function mapRevolving(tradelines) {
  const rows = [];
  for (const t of tradelines) {
    if (t?.isAU) continue;
    if (accountTypeOf(t) !== "revolving") continue;
    const creditor = t.creditorName || t.creditor || "";
    if (!creditor) continue;
    const balance = finiteNumber(t.currentBalance ?? t.balance);
    const limit = finiteNumber(t.effectiveLimit ?? t.creditLimit ?? t.limit);
    const pct = utilPct(balance, limit);
    rows.push([
      creditor,
      bureauCell(t),
      balance,
      limit,
      pct == null ? "" : `${pct}%`,
      utilTarget(limit),
      utilStatus(t, pct)
    ]);
  }
  return rows;
}

/**
 * Balance and limit across the de-duplicated open revolving rows.
 *
 * The engine's own totals are the tri-merge totals and are three times these on
 * a file that reports to all three bureaus. The PERCENTAGE is the same either
 * way — both sides scale together — so the engine keeps ownership of it and of
 * everything downstream. Only what is printed changes.
 */
function displayUtilTotals(revolvingRows) {
  let balance = 0;
  let limit = 0;
  let sawLimit = false;
  for (const row of revolvingRows || []) {
    if (row[6] === "CLOSED") continue;
    const b = finiteNumber(row[2]);
    const l = finiteNumber(row[3]);
    /* A card with no credit limit — a charge card, or no preset spending limit —
       has no 10% target, so it cannot contribute to a "pay down to 10% of your
       limits" figure. Counting its BALANCE while its limit is unknown would put a
       dollar in the numerator with nothing under it and overstate the paydown.
       The row still prints; it is only these two totals it stays out of. */
    if (l == null || l <= 0) continue;
    if (b != null) balance += b;
    limit += l;
    sawLimit = true;
  }
  return sawLimit ? { balance, limit } : null;
}

function mapAu(tradelines) {
  const au = tradelines.find((t) => t?.isAU && (t.creditorName || t.creditor));
  if (!au) return { creditor: "", bureau: "", limit: null, balance: null, util: "", age: "" };
  const balance = finiteNumber(au.currentBalance ?? au.balance);
  const limit = finiteNumber(au.effectiveLimit ?? au.creditLimit ?? au.limit);
  const pct = utilPct(balance, limit);
  return {
    creditor: au.creditorName || au.creditor || "",
    bureau: bureauCell(au),
    limit,
    balance,
    util: pct == null ? "" : `${pct}%`,
    age: monthsOpen(au.openedDate || au.dateOpened)
  };
}

function negativeType(t) {
  return t.currentRatingType || t.type || (t.isDerogatory ? "Derogatory" : "");
}

function mapNegatives(crsResult, tradelines) {
  const fromSignals = [];
  const negs = crsResult?.consumerSignals?.bureauNegatives || {};
  for (const key of BUREAU_KEYS) {
    for (const item of negs[key]?.items || []) {
      fromSignals.push({
        creditor: item.creditorName || item.creditor || "",
        bureau: bureauLabel(item.source || key),
        type: negativeType(item),
        balance: item.balance,
        source: item.source || key
      });
    }
  }
  const src = fromSignals.length
    ? fromSignals
    : tradelines
      .filter((t) => t?.isDerogatory || t?.currentRatingType === "ChargeOff")
      .map((t) => ({
        creditor: t.creditorName || t.creditor || "",
        bureau: bureauLabel(t.source),
        type: negativeType(t),
        balance: t.currentBalance ?? t.balance,
        source: t.source
      }));
  /* F43 again. One derogatory account furnishing to two bureaus is ONE problem
     to fix, not two, so the row carries both bureau names. The key is the same
     creditor+identifier pair the tradeline merge uses; bureauNegatives items
     carry no identifier, so those fall back on creditor + type + balance. */
  const merged = new Map();
  for (const item of src) {
    if (!item.creditor) continue;
    const key = [
      String(item.creditor).trim().toLowerCase(),
      String(item.type || "").toLowerCase(),
      String(finiteNumber(item.balance) ?? "")
    ].join("|");
    const seen = merged.get(key);
    if (seen) {
      const label = bureauLabel(item.source) || item.bureau;
      if (label && !seen.bureaus.includes(label)) seen.bureaus.push(label);
      continue;
    }
    merged.set(key, { ...item, bureaus: [item.bureau].filter(Boolean) });
  }
  const rows = [];
  let n = 1;
  for (const item of merged.values()) {
    const bal = finiteNumber(item.balance);
    rows.push({
      n,
      creditor: item.creditor,
      bureau: item.bureaus.join(", "),
      type: item.type || "",
      balance: bal == null ? "" : formatUsdPlain(bal),
      why: "",
      detail: ""
    });
    n += 1;
  }
  return rows;
}

function inquiryPriority(count) {
  if (!count) return "CLEAN";
  if (count >= 10) return "HIGH";
  return "MEDIUM";
}

function inquiryNote(list) {
  const by = new Map();
  for (const i of list) {
    const name = i.creditorName || i.creditor || i.subscriber || "";
    if (!name) continue;
    by.set(name, (by.get(name) || 0) + 1);
  }
  const dups = [...by.entries()].filter(([, c]) => c > 1);
  if (!dups.length) return "";
  return `Includes duplicates from ${dups.map(([name, c]) => `${name} (${c}x)`).join(", ")}.`;
}

function mapInquiries(inquiries) {
  const rows = [];
  for (const key of BUREAU_KEYS) {
    const list = inquiries.filter((i) => String(i.source || "").toLowerCase() === key);
    if (!list.length && !inquiries.some((i) => String(i.source || "").toLowerCase() === key)) {
      continue;
    }
    const count = list.length;
    rows.push([
      BUREAU_LABEL[key],
      count,
      inquiryPriority(count),
      count === 0 ? "No inquiries to address." : inquiryNote(list)
    ]);
  }
  return rows;
}

function mapPersonalData(identity) {
  const names = uniqueStrings(identity.names, formatIdentityName);
  const ssns = uniqueStrings(identity.ssns, (s) => (typeof s === "string" ? s : s?.value || s?.ssn || ""));
  const addresses = uniqueStrings(identity.addresses, formatAddress);
  const employers = uniqueStrings(identity.employers, (e) => (typeof e === "string" ? e : e?.name || e?.employerName || ""));
  const dobs = uniqueStrings(identity.dobs, (d) => (typeof d === "string" ? d : d?.value || d?.dob || ""));
  const rows = [];
  if (names.length > 1) {
    rows.push(["Name Variations", `${names.length} different names on file across bureaus`, "", "HIGH"]);
  }
  if (ssns.length > 1) {
    rows.push(["SSN Variations", `${ssns.length} different SSNs on file`, "", "HIGH"]);
  }
  if (addresses.length > 1) {
    rows.push(["Multiple Addresses", `${addresses.length} addresses across bureaus`, "", "MEDIUM"]);
  }
  if (employers.length > 1) {
    rows.push(["Employer Variations", `${employers.length} different employers listed`, "", "MEDIUM"]);
  }
  if (dobs.length === 1) {
    const on = uniqueStrings(identity.dobs, (d) => {
      if (!d || typeof d === "string") return "";
      return d.source || "";
    }).filter(Boolean);
    if (on.length && on.length < 3) {
      rows.push(["DOB", `DOB on file for ${on.length} bureau(s).`, "", "MEDIUM"]);
    }
  } else if (dobs.length > 1) {
    rows.push(["DOB", `${dobs.length} different dates of birth on file`, "", "HIGH"]);
  }
  return rows;
}

function mapTypedTradelines(tradelines, type) {
  const rows = [];
  for (const t of tradelines) {
    if (accountTypeOf(t) !== type) continue;
    const creditor = t.creditorName || t.creditor || "";
    if (!creditor) continue;
    const balance = finiteNumber(t.currentBalance ?? t.balance);
    rows.push([
      creditor,
      t.status || "",
      balance == null ? "" : formatUsdPlain(balance),
      t.currentRatingType || ""
    ]);
  }
  return rows;
}

function mapPublicObligations(records) {
  const rows = [];
  for (const pr of records) {
    const name = pr.creditorName || pr.courtName || pr.type || "";
    if (!name) continue;
    rows.push([
      name,
      pr.dispositionType || pr.status || "",
      pr.amount != null ? formatUsdPlain(finiteNumber(pr.amount)) : "",
      pr.type || ""
    ]);
  }
  return rows;
}

function parseEstRange(estRange) {
  const raw = String(estRange || "").trim();
  if (!raw) return { low: null, high: null };
  const m = raw.match(/\$?\s*([\d.]+)\s*([Kk])?\s*[-–]\s*\$?\s*([\d.]+)\s*([Kk])?/);
  if (!m) return { low: null, high: null };
  let low = Number(m[1]);
  let high = Number(m[3]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { low: null, high: null };
  if (m[2] || /k/i.test(raw)) low = Math.round(low * 1000);
  if (m[4] || /k/i.test(raw)) high = Math.round(high * 1000);
  return { low, high };
}

function lenderCategory(type) {
  const t = String(type || "");
  if (/personal loan/i.test(t)) return "Personal Loans";
  if (/personal card/i.test(t)) return "Personal Cards";
  if (/biz card|business card/i.test(t)) return "Business Cards";
  if (/^loc$|line of credit/i.test(t)) return "Business Lines of Credit";
  if (/term loan/i.test(t)) return "Business Term Loans";
  return t;
}

// ═══════════════════════════════════════════════════════════════════════════════
// F44 — THE BUSINESS THE CLIENT ALREADY HAS
//
// The vendor matcher decides "Business entity required" from
// businessSignals.available, which is true only when a real BUSINESS CREDIT
// REPORT was passed to the engine. Fundhub does not buy one, so `available` is
// false for every client — and a client with a company on file for six years
// was still told to go form an LLC, in a document with his name on it.
//
// This does NOT touch money. The business half of the pre-approval is gated on
// the same `bs.available === true` inside the vendor's estimate-preapprovals.js
// and stays exactly where it is; inventing a business figure off an age alone is
// the defect the owner closed on 2026-09-03 (F15, ../underwrite/business-funding.mjs:
// "no company row, no business funding"). What changes is what the client is
// TOLD: a lender that wants an entity is judged on the entity that exists, and
// the roadmap stops opening with "file an LLC" for a business that is six years
// old.
// ═══════════════════════════════════════════════════════════════════════════════

/** businessSignals for the MATCHER only. Never handed to the estimator. */
function matcherBusinessSignals(engineSignals, business) {
  if (!business?.hasEntity) return engineSignals;
  const ageMonths = finiteNumber(business.ageMonths);
  return {
    ...(engineSignals && typeof engineSignals === "object" ? engineSignals : {}),
    available: true,
    profile: {
      ...(engineSignals?.profile && typeof engineSignals.profile === "object" ? engineSignals.profile : {}),
      ageMonths: ageMonths == null ? 0 : ageMonths
    }
  };
}

function lenderRow(lender, bucket) {
  const { low, high } = parseEstRange(lender.estRange);
  if (low == null || high == null) return null;
  const score = finiteNumber(lender.minScore);
  if (score == null) return null;
  return [
    lender.name || "",
    lenderCategory(lender.type),
    lender.type || "",
    low,
    high,
    score,
    lender.minTIB ? `${lender.minTIB} months minimum` : null,
    lender.minRevenue ? `$${Number(lender.minRevenue).toLocaleString("en-US")}/year minimum` : null,
    lender.whyFit || lender.whatNeeded || "",
    bucket,
    lender.whatNeeded || ""
  ];
}

/**
 * A gate the lender states that this system has never checked.
 *
 * "N lenders are open to you today" has to be true of every lender under it.
 * The vendor matcher (vendor/underwriteiq-full/api/lite/crs/lender-matrix.js:161-207)
 * tests three things — entity, months in business, score — and NEVER reads
 * `minRevenue`, even though four of its lenders state one: OnDeck $100,000,
 * Bluevine $120,000, Kabbage $50,000, Credibly $180,000 a year. Nothing in this
 * product captures a client's business revenue, so that floor cannot be met, only
 * unmet or unknown. Unknown is not met.
 *
 * So a revenue floor moves the lender to the "after optimization" list with the
 * floor named as what is still needed. It is never a denial and never a zero —
 * the lender still appears, with its real requirement printed instead of an
 * availability we cannot stand behind.
 *
 * @returns {string|null} what is still needed, or null when every stated gate is met
 */
function unverifiedGate(lender) {
  const minRevenue = finiteNumber(lender?.minRevenue);
  if (minRevenue == null || minRevenue <= 0) return null;
  return `$${minRevenue.toLocaleString("en-US")}/year in business revenue required (not on file)`;
}

/**
 * F45. The vendor matcher returns two buckets and this used to flatten them,
 * which is why the printed shortlist put all fifteen lenders under "after
 * optimization" and left "available right now" empty on every document.
 */
function mapLenders(crsResult, business) {
  const cs = crsResult?.consumerSignals;
  const outcome = crsResult?.outcome;
  if (!cs?.scores) return { all: [], now: [], after: [] };
  let matched;
  try {
    matched = matchLenders(cs, matcherBusinessSignals(crsResult?.businessSignals, business), outcome);
  } catch {
    return { all: [], now: [], after: [] };
  }
  const now = [];
  const after = [];
  for (const lender of matched.availableNow || []) {
    const unmet = unverifiedGate(lender);
    const row = lenderRow(unmet ? { ...lender, whatNeeded: unmet } : lender, unmet ? "after" : "now");
    if (row) (unmet ? after : now).push(row);
  }
  for (const lender of matched.afterOptimization || []) {
    const row = lenderRow(lender, "after");
    if (row) after.push(row);
  }
  return { all: [...now, ...after], now, after };
}

/**
 * The reference set's score ladder: every lender still out of reach, grouped by
 * the score it wants, with how many points away this client is. Nothing is
 * projected — the gap is arithmetic on two numbers already on the file.
 */
function scoreLadder(afterRows, median) {
  const med = finiteNumber(median);
  if (med == null) return [];
  const byScore = new Map();
  for (const row of afterRows || []) {
    const score = finiteNumber(row[5]);
    if (score == null || score <= med) continue;
    if (!byScore.has(score)) byScore.set(score, []);
    byScore.get(score).push(row[0]);
  }
  return [...byScore.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([score, names]) => ({ score, gap: score - med, names, count: names.length }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// "WHAT IS COSTING YOU MONEY" AND "WHAT DOES NOT AFFECT YOUR FUNDING"
//
// COMPLIANCE REVIEW REQUIRED — credit-repair messaging. Marker only.
//
// Both sections in the designed reference set are ranked lists of the client's
// own problems with a plain-English line each. NOTHING IS AUTHORED HERE. Every
// sentence is the vendor engine's own optimization finding — code, severity,
// plainEnglishProblem, whyItMatters, whatToDoNext — written at a 5th grade
// reading level by rules the engine already ships
// (vendor/underwriteiq-full/api/lite/crs/optimization-findings.js). This file
// only sorts them, splits them into the two sections, and de-duplicates the
// tri-merge repeats.
//
// The split is the engine's own category, not a judgement made here: the
// engine's rule is "Inquiries do not affect funding — never imply they hurt
// funding", and an AU finding says the client "is not responsible for the debt".
// Those are the not-a-factor section. Everything the engine flags as a real
// problem is the costing-you section.
// ═══════════════════════════════════════════════════════════════════════════════

const SEVERITY_ORDER = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3, info: 4 });

/* EVERY CODE IN THE THREE SETS BELOW WAS READ OUT OF THE ENGINE, NOT GUESSED.
   The first cut of this file listed eight code names that the engine has never
   emitted (UTIL_HIGH, UTIL_CRITICAL, UTIL_OVERALL, UTIL_OVERALL_OVER_10,
   AU_ACCOUNT, AU_DOMINANCE, AU_NOT_RESPONSIBLE, INQUIRY_DUPLICATES) and missed
   the ones it does, so the corrections below silently did not fire. The full
   list is one command:

     grep -oE 'makeFinding\("[A-Z_0-9]+", "[a-z_]+"' \
       vendor/underwriteiq-full/api/lite/crs/optimization-findings.js | sort -u

   Anything added here must appear in that output. */

/* Findings about HOW to play the file rather than what is wrong with it. The
   reference set puts these in "Your Next Step", not in the ranked problem list —
   "do not open new accounts before funding" is advice, not a cost.
   Engine category "strategic": FUNDING_FIRST, PREMIUM_MAINTENANCE, REQUEST_CLI,
   STRONG_ANCHOR — all four are caught by the category test, so this set only
   exists for a code the engine may later file under another category. */
const STRATEGIC_CODES = Object.freeze(new Set(["FUNDING_FIRST"]));

/* The engine's OVERALL utilisation findings name dollar figures worked out from
   the tri-merge totals, which count an account once per bureau (F43). Their
   percentage is right — both sides of the fraction triple together — but the
   dollars are three times too high on a file that reports to all three.
   optimization-findings.js:144 emits UTIL_OVERALL_HIGH above 30% and :165
   UTIL_MODERATE between 10% and 30%. Both are corrected here, against the
   de-duplicated totals this file already computes, and only the numbers: the
   sentences around them are the engine's own approved wording. */
const OVERALL_UTIL_CODES = Object.freeze(new Set(["UTIL_MODERATE", "UTIL_OVERALL_HIGH"]));

/** Findings the engine says do NOT affect a funding decision.
 *  The engine files its three authorized-user findings under "utilization"
 *  (AU_HIGH_UTIL) and "tradeline_quality" (AU_GOOD_KEEP, AU_NEGATIVE_MARKS), so
 *  the category test never caught them and all three were being ranked in "What
 *  Is Costing You Money" — next to a new section of the Credit Analysis Report
 *  telling the same client the same account is not his problem. All three of the
 *  engine's own sentences open "You are not responsible for this debt", which is
 *  the not-a-factor rule, so they are routed by CODE here. */
const NOT_A_FACTOR_CATEGORIES = Object.freeze(new Set(["inquiries"]));
const NOT_A_FACTOR_CODES = Object.freeze(new Set([
  "INQUIRY_DUPLICATE", "INQUIRY_REMOVAL",
  "AU_HIGH_UTIL", "AU_GOOD_KEEP", "AU_NEGATIVE_MARKS",
  "DONT_CLOSE_OLDEST", "STRONG_ANCHOR"
]));

function findingsOf(crsResult) {
  const list = crsResult?.findings || crsResult?.optimization_findings;
  if (!Array.isArray(list)) return [];
  /* The tri-merge repeats every account, so the engine repeats every account's
     finding. Same defect as F43, same fix: one row per real problem. */
  const seen = new Set();
  const out = [];
  for (const f of list) {
    if (!f || typeof f !== "object") continue;
    if (f.customerSafe === false) continue;
    const key = `${f.code || ""}|${f.targetState || ""}|${f.plainEnglishProblem || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function isStrategic(f) {
  return String(f.category || "").toLowerCase() === "strategic"
    || STRATEGIC_CODES.has(String(f.code || "").toUpperCase());
}

function isNotAFactor(f) {
  return NOT_A_FACTOR_CATEGORIES.has(String(f.category || "").toLowerCase())
    || NOT_A_FACTOR_CODES.has(String(f.code || "").toUpperCase());
}

function findingLines(f) {
  return [f.plainEnglishProblem, f.whyItMatters, f.whatToDoNext]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
}

function bySeverity(a, b) {
  const sa = SEVERITY_ORDER[String(a.severity || "").toLowerCase()] ?? 9;
  const sb = SEVERITY_ORDER[String(b.severity || "").toLowerCase()] ?? 9;
  return sa - sb;
}

/* F44. The engine emits NO_BUSINESS_ENTITY off businessSignals.available, which
   is false for every Fundhub client because no business credit report is bought.
   Telling a client with a six-year-old company on file to go form an LLC is the
   defect; the company on file is the answer to it. */
const NO_ENTITY_CODES = Object.freeze(new Set(["NO_BUSINESS_ENTITY", "BUSINESS_ENTITY_MISSING"]));

/**
 * The tri-merge dollar figures inside an overall-utilisation finding, mapped to
 * their de-duplicated counterparts.
 *
 * A blanket `line.replace(/\$[\d,]+/g, target)` is wrong here and was the first
 * cut. UTIL_OVERALL_HIGH's problem sentence carries TWO figures — the balance
 * and the limit — and its next-step sentence carries a third, the 10% target.
 * Rewriting all three to the target produces "you are using 45% of your
 * available credit. That is $1,000 in balances against $1,000 in limits."
 *
 * So each figure is swapped for its own counterpart, matched BY VALUE rather
 * than by position or by wording. The engine's own totals are the keys, this
 * file's de-duplicated totals are the values, and a dollar amount that is
 * neither is left exactly as the engine wrote it.
 */
function utilMoneyMap(engineUtil, display) {
  const map = new Map();
  if (!engineUtil || !display) return map;
  const pairs = [
    [finiteNumber(engineUtil.totalBalance), display.balance],
    [finiteNumber(engineUtil.totalLimit), display.limit],
    [
      finiteNumber(engineUtil.totalLimit) == null
        ? null
        : Math.round(finiteNumber(engineUtil.totalLimit) * 0.1),
      display.target
    ]
  ];
  for (const [from, to] of pairs) {
    if (from == null || to == null) continue;
    if (from === to) continue;
    map.set(from, to);
  }
  return map;
}

function correctedLines(f, moneyMap) {
  const lines = findingLines(f);
  if (!moneyMap || moneyMap.size === 0) return lines;
  if (!OVERALL_UTIL_CODES.has(String(f.code || "").toUpperCase())) return lines;
  return lines.map((line) => line.replace(/\$[\d,]+/g, (token) => {
    const n = Number(token.replace(/[^0-9]/g, ""));
    if (!Number.isFinite(n) || !moneyMap.has(n)) return token;
    return formatUsdPlain(moneyMap.get(n));
  }));
}

function mapCostingYou(findings, business, moneyMap) {
  const hasEntity = business?.hasEntity === true;
  const rows = findings
    .filter((f) => !isNotAFactor(f) && !isStrategic(f))
    .filter((f) => !(hasEntity && NO_ENTITY_CODES.has(String(f.code || "").toUpperCase())))
    .sort(bySeverity);
  return rows.map((f, i) => ({
    n: i + 1,
    code: f.code || "",
    severity: String(f.severity || "").toLowerCase(),
    title: String(f.targetState || f.plainEnglishProblem || "").trim(),
    lines: correctedLines(f, moneyMap)
  }));
}

function mapStrategic(findings) {
  return findings.filter(isStrategic).sort(bySeverity).map((f) => ({
    code: f.code || "",
    title: String(f.targetState || f.plainEnglishProblem || "").trim(),
    lines: findingLines(f)
  }));
}

function mapNotAFactor(findings) {
  return findings.filter((f) => isNotAFactor(f) && !isStrategic(f)).sort(bySeverity).map((f) => ({
    code: f.code || "",
    title: String(f.targetState || f.plainEnglishProblem || "").trim(),
    lines: findingLines(f)
  }));
}

/**
 * The date printed on every cover. It was never assigned, so every document the
 * live site produced carried a blank DATE box (F50). It is the day the credit
 * file was pulled — the date the numbers below it are true as of — and falls
 * back to today only when the pull carries no date of its own.
 */
export function reportDate(crsResult, now = new Date()) {
  const raw = crsResult?.pulledAt
    || crsResult?.responseDetail?.dateRequested
    || crsResult?.normalized?.meta?.pulledAt
    || null;
  const d = raw ? new Date(raw) : now;
  const when = Number.isNaN(d.getTime()) ? now : d;
  return when.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * The booking page a client is actually sent to. The designed reference set
 * prints `www.fundhubbookingurl.template` — a placeholder in the template that
 * was never replaced — and the Node printer fell back to the bare string
 * "fundhub.ai", which is not a booking page either. One resolver, the same one
 * every text message and email already uses (../insights/meet.mjs).
 */
export function bookingUrlFor(personal, env = process.env) {
  const fromClient = String(personal?.bookingUrl || personal?.booking_link || "").trim();
  if (/^https?:\/\//i.test(fromClient)) return fromClient;
  const fromEnv = String(env.BOOKING_URL || "").trim();
  if (/^https?:\/\//i.test(fromEnv)) return fromEnv;
  return salesMeetBookingUrl(env);
}

function preapprovalOf(block) {
  if (!block || typeof block !== "object") return null;
  return finiteNumber(block.totalCombined);
}

function oneLineAddress(address) {
  return String(address || "").replace(/\s*\n\s*/g, ", ").trim();
}

function stateFromPersonal(personal, address) {
  if (personal?.state) return String(personal.state).trim();
  const m = String(address || "").match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/);
  return m ? m[1] : "";
}

/**
 * Prefer the live engine object. Fill empty score / tradeline / preapproval
 * slots from the stored CRS row. Never overwrite a real engine number.
 */
export function mergeStoredUnderwrite(engine, stored) {
  if (!stored || typeof stored !== "object") return engine;
  if (!engine || typeof engine !== "object") return stored;
  const merged = {
    ...stored,
    ...engine,
    scores: { ...(stored.scores || {}), ...(engine.scores || {}) },
    consumerSignals: {
      ...(stored.consumerSignals || {}),
      ...(engine.consumerSignals || {}),
      scores: {
        ...(stored.consumerSignals?.scores || {}),
        ...(engine.consumerSignals?.scores || {}),
        perBureau: {
          ...(stored.consumerSignals?.scores?.perBureau || {}),
          ...(engine.consumerSignals?.scores?.perBureau || {})
        }
      },
      utilization: engine.consumerSignals?.utilization || stored.consumerSignals?.utilization,
      bureauNegatives: engine.consumerSignals?.bureauNegatives || stored.consumerSignals?.bureauNegatives
    },
    preapprovals: engine.preapprovals || stored.preapprovals,
    projectedPreapproval: engine.projectedPreapproval || stored.projectedPreapproval,
    normalized: {
      ...(stored.normalized || {}),
      ...(engine.normalized || {}),
      tradelines: (engine.normalized?.tradelines?.length
        ? engine.normalized.tradelines
        : (stored.normalized?.tradelines?.length ? stored.normalized.tradelines : stored.tradelines || [])),
      inquiries: (engine.normalized?.inquiries?.length
        ? engine.normalized.inquiries
        : (stored.normalized?.inquiries?.length ? stored.normalized.inquiries : stored.inquiries || [])),
      identity: engine.normalized?.identity || stored.normalized?.identity || stored.identity || {}
    },
    tradelines: engine.tradelines?.length ? engine.tradelines : stored.tradelines,
    inquiries: engine.inquiries?.length ? engine.inquiries : stored.inquiries,
    outcome: engine.outcome || stored.outcome
  };
  const per = merged.consumerSignals.scores.perBureau;
  if (per.ex == null && stored.scores?.ex != null) per.ex = stored.scores.ex;
  if (per.eq == null && stored.scores?.eq != null) per.eq = stored.scores.eq;
  if (per.tu == null && stored.scores?.tu != null) per.tu = stored.scores.tu;
  return merged;
}

/**
 * @param {object}  input
 * @param {object} [input.crsResult] the engine result for this client
 * @param {object} [input.personal]  name and address the letters are addressed from
 * @param {object} [input.business]  what this client has on file for a company.
 *   `{ hasEntity, ageMonths, name }`. Display only — see the F44 block above.
 * @param {Date}   [input.now]       injectable clock, for the date on the cover
 * @returns {object} CLIENT dict for fundhub_gen.py --client
 */
export function buildBlackReportClient({
  crsResult = null,
  personal = null,
  business = null,
  now = new Date()
} = {}) {
  const client = emptyBlackReportClient();
  const who = personal && typeof personal === "object" ? personal : {};
  const address = oneLineAddress(who.address);
  client.applicant = String(who.name || "").trim() || "Client";
  client.address = address;
  client.state = stateFromPersonal(who, address);
  client.outcome = crsResult?.outcome ? String(crsResult.outcome) : "";
  client.booking_url = bookingUrlFor(who);
  const biz = business && typeof business === "object" ? business : {};
  client.business = {
    hasEntity: biz.hasEntity === true,
    ageMonths: finiteNumber(biz.ageMonths),
    name: String(biz.name || "").trim()
  };
  if (crsResult) {
    client.date = reportDate(crsResult, now);
    client.scores = scoresFromEngine(crsResult);
    client.preapproval_now = preapprovalOf(crsResult.preapprovals);
    client.preapproval_after = preapprovalOf(crsResult.projectedPreapproval);
    if (client.preapproval_now == null) client.preapproval_now = 0;
    if (client.preapproval_after == null) client.preapproval_after = client.preapproval_now;
    const util = crsResult.consumerSignals?.utilization;
    if (util) {
      client.util_pct = util.pct == null ? "" : `${util.pct}%`;
    }
    /* F43. One row per real account, and the printed totals to match. */
    const tradelines = dedupeTradelines(tradelinesOf(crsResult));
    client.bureaus = mapBureaus(crsResult);
    client.revolving = mapRevolving(tradelines);
    const totals = displayUtilTotals(client.revolving);
    if (totals) {
      client.util_total_balance = totals.balance;
      client.util_total_limit = totals.limit;
      client.util_target_balance = Math.round(totals.limit * 0.1);
    } else if (util) {
      client.util_total_balance = finiteNumber(util.totalBalance);
      client.util_total_limit = finiteNumber(util.totalLimit);
      if (client.util_total_limit != null) {
        client.util_target_balance = Math.round(client.util_total_limit * 0.1);
      }
    }
    client.au_account = mapAu(tradelines);
    client.negatives = mapNegatives(crsResult, tradelines);
    const inquiries = inquiriesOf(crsResult);
    client.inquiries = mapInquiries(inquiries);
    client.inquiry_total = inquiries.length;
    client.personal_data = mapPersonalData(identityOf(crsResult));
    client.installments = mapTypedTradelines(tradelines, "installment");
    client.mortgages = mapTypedTradelines(tradelines, "mortgage");
    client.public_obligations = mapPublicObligations(publicRecordsOf(crsResult));
    const lenders = mapLenders(crsResult, client.business);
    client.lenders = lenders.all;
    client.lenders_now = lenders.now;
    client.lenders_after = lenders.after;
    client.score_ladder = scoreLadder(lenders.after, crsResult.consumerSignals?.scores?.median);
    const findings = findingsOf(crsResult);
    const utilMoney = utilMoneyMap(util, {
      balance: client.util_total_balance,
      limit: client.util_total_limit,
      target: client.util_target_balance
    });
    client.costing_you = mapCostingYou(findings, client.business, utilMoney);
    client.not_a_factor = mapNotAFactor(findings);
    client.strategy = mapStrategic(findings);
  }
  return client;
}

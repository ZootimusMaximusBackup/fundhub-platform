// Map UnderwriteIQ / CRS engine output into the CLIENT dict that
// scripts/black-reports/fundhub_gen.py expects.
//
// Absence stays empty. No Jordan Sample leftovers. No invented scores,
// balances, lenders, or personal facts.
// COMPLIANCE REVIEW REQUIRED — credit-repair / projected-score adjacent.

import { createRequire } from "node:module";

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
    personal_data: [],
    installments: [],
    mortgages: [],
    public_obligations: [],
    lenders: []
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

/**
 * The account number a bureau copy carries. A tri-merge pull returns the SAME
 * account once per bureau that furnishes it, and each copy repeats this string.
 * It is the only thing that can tell "three bureaus reporting one Chase card"
 * apart from "three different Chase cards", so a row without one is never
 * merged with anything — the conservative side, since printing a duplicate is
 * a smaller error than silently deleting a real second account.
 */
function accountKeyOf(t) {
  const id = String(
    t?.accountIdentifier || t?.account_ref || t?.accountNumber || t?.account_number || ""
  ).trim().toLowerCase();
  return id || null;
}

/**
 * ONE ROW PER ACCOUNT, NOT ONE ROW PER BUREAU COPY. Recorded as F43: the report
 * printed nine credit-card rows for three cards and one car-loan row per bureau,
 * because a tri-merge pull genuinely carries every account three times and this
 * list was being printed exactly as it arrived.
 *
 * Merging happens here, in the printer, rather than in the credit file, because
 * the three copies are real and everything upstream of this point is entitled to
 * see all of them — the letter engine writes a different letter per bureau, and
 * the negatives table below is per-bureau on purpose. It is only the customer's
 * account tables that want one line per account.
 *
 * The surviving row keeps `sources`, every bureau that reported the account, so
 * the bureau column can still say who is reporting it. Where copies disagree on
 * balance or limit the LARGEST is kept: a bureau that has not caught up shows a
 * smaller balance, and understating what the client owes is the direction that
 * flatters the report.
 */
function collapseBureauCopies(list) {
  const out = [];
  const byKey = new Map();
  for (const t of list) {
    const key = accountKeyOf(t);
    if (!key) { out.push({ ...t, sources: t.source ? [t.source] : [] }); continue; }
    const seen = byKey.get(key);
    if (!seen) {
      const row = { ...t, sources: t.source ? [t.source] : [] };
      byKey.set(key, row);
      out.push(row);
      continue;
    }
    if (t.source && !seen.sources.includes(t.source)) seen.sources.push(t.source);
    if (num(t.currentBalance) > num(seen.currentBalance)) seen.currentBalance = t.currentBalance;
    if (num(t.effectiveLimit) > num(seen.effectiveLimit)) seen.effectiveLimit = t.effectiveLimit;
    // A negative on ANY bureau is a negative. One clean copy does not clear it.
    if (t.isDerogatory) seen.isDerogatory = true;
  }
  return out;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : -Infinity;
}

/**
 * Total balance and total limit across OPEN PRIMARY REVOLVING accounts, from a
 * list that has already had its bureau copies collapsed. Same test the engine
 * uses in derive-consumer-signals.js — not an authorized user, revolving, open —
 * but matched case-insensitively, because the rows reaching this file are
 * sometimes the engine's lower-case spellings and sometimes the vendor's
 * capitalised ones.
 *
 * Returns null when there is nothing to sum, so the caller can fall back to
 * whatever the engine stored rather than printing a confident $0.
 */
function sumOpenRevolving(tradelines) {
  const open = tradelines.filter(
    (t) => !t?.isAU && accountTypeOf(t) === "revolving" && isOpenAccount(t)
  );
  if (!open.length) return null;
  let totalBalance = 0;
  let totalLimit = 0;
  for (const t of open) {
    totalBalance += finiteNumber(t.currentBalance) ?? 0;
    totalLimit += finiteNumber(t.effectiveLimit) ?? 0;
  }
  return {
    totalBalance,
    totalLimit,
    pct: totalLimit > 0 ? Math.round((totalBalance / totalLimit) * 100) : null
  };
}

function tradelinesOf(crsResult) {
  const fromNorm = crsResult?.normalized?.tradelines;
  const fromTop = crsResult?.tradelines;
  const list = Array.isArray(fromNorm) && fromNorm.length
    ? fromNorm
    : (Array.isArray(fromTop) ? fromTop : []);
  return collapseBureauCopies(list.map(normalizeTradeline).filter(Boolean));
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

/**
 * Which bureaus report this account, for a row that may have been merged from
 * several bureau copies. All three is written as "All 3 bureaus" rather than
 * three names, because the column is narrow and "reported everywhere" is the
 * thing the client needs to read.
 */
function bureauLabelOf(t) {
  const names = (Array.isArray(t?.sources) ? t.sources : [t?.source])
    .map(bureauLabel)
    .filter(Boolean);
  const uniq = [...new Set(names)];
  if (!uniq.length) return "";
  if (uniq.length >= BUREAU_KEYS.length) return "All 3 bureaus";
  return uniq.join(", ");
}

function accountTypeOf(t) {
  return String(t?.accountType || t?.account_type || "").toLowerCase();
}

function isClosed(t) {
  const status = String(t?.status || "").toLowerCase();
  return status.includes("close") || status.includes("paid") || status.includes("charge");
}

/**
 * Is this account still open? Two field spellings reach this file and they are
 * not interchangeable. The engine's normalized rows put "open" / "closed" in
 * `status`. A stored credit file puts the PAYMENT status there — "Current",
 * "Pays as agreed" — and keeps open-or-closed in `accountStatusType`. Reading
 * only `status` therefore found no open cards at all on a stored file, which is
 * how the utilisation totals quietly fell back to the engine's tripled figures.
 */
function isOpenAccount(t) {
  const raw = `${t?.status || ""} ${t?.accountStatusType || t?.account_status_type || ""}`.toLowerCase();
  if (raw.includes("close") || raw.includes("charge") || raw.includes("paid")) return false;
  return raw.includes("open") || raw.includes("current") || raw.includes("agreed") || raw.includes("late");
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
  return `$${Math.round(limit * 0.1)} or less`;
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
  for (const item of mapNegatives(crsResult, tradelinesOf(crsResult))) {
    const key = bureauSource(item.bureau);
    if (byBureau[key] != null) byBureau[key] += 1;
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
      bureauLabelOf(t),
      balance,
      limit,
      pct == null ? "" : `${pct}%`,
      utilTarget(limit),
      utilStatus(t, pct)
    ]);
  }
  return rows;
}

function mapAu(tradelines) {
  const au = tradelines.find((t) => t?.isAU && (t.creditorName || t.creditor));
  if (!au) return { creditor: "", bureau: "", limit: null, balance: null, util: "", age: "" };
  const balance = finiteNumber(au.currentBalance ?? au.balance);
  const limit = finiteNumber(au.effectiveLimit ?? au.creditLimit ?? au.limit);
  const pct = utilPct(balance, limit);
  return {
    creditor: au.creditorName || au.creditor || "",
    bureau: bureauLabelOf(au),
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
        bureau: bureauLabelOf(t),
        type: negativeType(t),
        balance: t.currentBalance ?? t.balance,
        source: t.source
      }));
  const rows = [];
  let n = 1;
  for (const item of src) {
    if (!item.creditor) continue;
    const bal = finiteNumber(item.balance);
    rows.push({
      n,
      creditor: item.creditor,
      bureau: item.bureau,
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

function mapLenders(crsResult) {
  const cs = crsResult?.consumerSignals;
  const bs = crsResult?.businessSignals;
  const outcome = crsResult?.outcome;
  if (!cs?.scores) return [];
  let matched;
  try {
    matched = matchLenders(cs, bs, outcome);
  } catch {
    return [];
  }
  const list = [...(matched.availableNow || []), ...(matched.afterOptimization || [])];
  const rows = [];
  for (const lender of list) {
    const { low, high } = parseEstRange(lender.estRange);
    if (low == null || high == null) continue;
    const score = finiteNumber(lender.minScore);
    if (score == null) continue;
    rows.push([
      lender.name || "",
      lenderCategory(lender.type),
      lender.type || "",
      low,
      high,
      score,
      lender.minTIB ? `${lender.minTIB} months minimum` : null,
      lender.minRevenue ? `$${Number(lender.minRevenue).toLocaleString("en-US")}/year minimum` : null,
      lender.whyFit || lender.whatNeeded || ""
    ]);
  }
  return rows;
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
 * @param {{ crsResult?: object, personal?: object }} input
 * @returns {object} CLIENT dict for fundhub_gen.py --client
 */
export function buildBlackReportClient({ crsResult = null, personal = null } = {}) {
  const client = emptyBlackReportClient();
  const who = personal && typeof personal === "object" ? personal : {};
  const address = oneLineAddress(who.address);
  client.applicant = String(who.name || "").trim() || "Client";
  client.address = address;
  client.state = stateFromPersonal(who, address);
  client.outcome = crsResult?.outcome ? String(crsResult.outcome) : "";
  client.booking_url = process.env.BOOKING_URL ? String(process.env.BOOKING_URL).trim() : "";
  if (crsResult) {
    client.scores = scoresFromEngine(crsResult);
    client.preapproval_now = preapprovalOf(crsResult.preapprovals);
    client.preapproval_after = preapprovalOf(crsResult.projectedPreapproval);
    if (client.preapproval_now == null) client.preapproval_now = 0;
    if (client.preapproval_after == null) client.preapproval_after = client.preapproval_now;
    const tradelines = tradelinesOf(crsResult);
    /* THE MONEY ON THE UTILISATION PAGE, F43's other half. The engine's
       consumerSignals.utilization sums the OPEN PRIMARY REVOLVING rows it was
       given, and on a tri-merge pull it is given every card three times — so its
       dollar totals are three times what the client actually owes and three
       times the credit line he actually has. On the funding walk that printed
       "$8,250 out of $135,000" and a paydown target of $13,500, for a file whose
       real figures are $2,750 out of $45,000 and a target of $4,500.

       The PERCENTAGE was always right, because both halves were multiplied by
       the same number. Only the dollars were wrong, and the dollars are what the
       client is told to act on.

       So the totals are re-summed here from the collapsed, one-row-per-account
       list, using the same test the engine uses — not an authorized user, a
       revolving account, and open. A charged-off card is closed and is correctly
       left out. The engine's figures are still the fallback for a stored pull
       that carries signals but no tradelines to re-sum. */
    const util = crsResult.consumerSignals?.utilization;
    const summed = sumOpenRevolving(tradelines);
    if (summed || util) {
      client.util_total_balance = summed ? summed.totalBalance : finiteNumber(util.totalBalance);
      client.util_total_limit = summed ? summed.totalLimit : finiteNumber(util.totalLimit);
      const pct = summed && summed.pct != null ? summed.pct : util?.pct;
      client.util_pct = pct == null ? "" : `${pct}%`;
      if (client.util_total_limit != null) {
        client.util_target_balance = Math.round(client.util_total_limit * 0.1);
      }
    }
    client.bureaus = mapBureaus(crsResult);
    client.revolving = mapRevolving(tradelines);
    client.au_account = mapAu(tradelines);
    client.negatives = mapNegatives(crsResult, tradelines);
    client.inquiries = mapInquiries(inquiriesOf(crsResult));
    client.personal_data = mapPersonalData(identityOf(crsResult));
    client.installments = mapTypedTradelines(tradelines, "installment");
    client.mortgages = mapTypedTradelines(tradelines, "mortgage");
    client.public_obligations = mapPublicObligations(publicRecordsOf(crsResult));
    client.lenders = mapLenders(crsResult);
  }
  return client;
}

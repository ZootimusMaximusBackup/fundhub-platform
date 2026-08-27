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

function tradelinesOf(crsResult) {
  const fromNorm = crsResult?.normalized?.tradelines;
  const fromTop = crsResult?.tradelines;
  const list = Array.isArray(fromNorm) && fromNorm.length
    ? fromNorm
    : (Array.isArray(fromTop) ? fromTop : []);
  return list.map(normalizeTradeline).filter(Boolean);
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
      bureauLabel(t.source),
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
    bureau: bureauLabel(au.source),
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
    const util = crsResult.consumerSignals?.utilization;
    if (util) {
      client.util_total_balance = finiteNumber(util.totalBalance);
      client.util_total_limit = finiteNumber(util.totalLimit);
      client.util_pct = util.pct == null ? "" : `${util.pct}%`;
      if (client.util_total_limit != null) {
        client.util_target_balance = Math.round(client.util_total_limit * 0.1);
      }
    }
    const tradelines = tradelinesOf(crsResult);
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

// CRS snapshot negative-item keys + AX-07 pause + pause recovery (spec 5B.1).
// Diff lives on top of u-03. Do not build a second snapshot pipeline.

import { mergeCustomFields } from "../workflows/custom-fields.mjs";
import { addTags, removeTags } from "../workflows/tags.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";
import { createTask } from "../lib/create-task.mjs";
import { FUNDING_PAUSED_HOLD } from "../inquiry-ops/doc-gate.mjs";
import { BUREAU_CODES, bureauOf } from "../finance/crs-map.mjs";
import { getOffer } from "../config/offers.mjs";
import { createPaymentLink } from "../payment-links/index.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-AX07-FUNDING-PAUSED";
export const SMS_TEMPLATE_KEY = "SMS-AX07-FUNDING-PAUSED";
export const SOURCE_WORKFLOW = "ax-07-funding-paused";
export const RECOVERY_WORKFLOW = "ax-07-pause-recovery";
export const RELEASE_ROUTE_CLEAN_BUREAUS = "fund_clean_bureaus";
export const PAUSED_TAG = "funding:paused";

const NEGATIVE_RE =
  /charge[\s_-]?off|collection|repossess|derogator|bankrupt|tax[\s_-]?lien|judgment|foreclos|settled for less/i;

function blobOf(obj) {
  if (!obj || typeof obj !== "object") return "";
  return [
    obj.remarks, obj.remark, obj.status, obj.payStatus, obj.paymentStatus,
    obj.payment_status, obj.accountCondition, obj.account_condition,
    obj.rating, obj.accountType, obj.derogatoryIndicator, obj.type, obj.kind
  ].filter(Boolean).map(String).join(" ");
}

function kindFrom(blob) {
  const s = String(blob || "").toLowerCase();
  if (/charge/.test(s)) return "charge_off";
  if (/repossess/.test(s)) return "repossession";
  if (/collection/.test(s)) return "collection";
  if (/bankrupt/.test(s)) return "bankruptcy";
  if (/lien/.test(s)) return "tax_lien";
  if (/judgment/.test(s)) return "judgment";
  if (/foreclos/.test(s)) return "foreclosure";
  return "derogatory";
}

function isNegativeTradeline(t) {
  if (!t) return false;
  const blob = blobOf(t);
  return t.collectionIndicator === true || t.derogatoryIndicator === true || NEGATIVE_RE.test(blob);
}

function bureauForTradeline(t, result) {
  const direct = bureauOf(t?.source || t?.bureau || t?.sourceType);
  if (direct) return direct;
  const id = t?.accountIdentifier || t?.accountNumber;
  if (!id || !result?.bureaus) return null;
  for (const code of BUREAU_CODES) {
    const lines = result.bureaus[code]?.tradelines;
    if (!Array.isArray(lines)) continue;
    if (lines.some((x) => (x?.accountIdentifier || x?.accountNumber) === id)) return code;
  }
  return null;
}

export function negativeKeysFromResult(result) {
  const keys = [];
  for (const t of Array.isArray(result?.tradelines) ? result.tradelines : []) {
    if (!isNegativeTradeline(t)) continue;
    const blob = blobOf(t);
    const id = t.accountIdentifier || t.accountNumber || t.creditorName || t.subscriberName || "unknown";
    keys.push(`tl:${String(id)}:${kindFrom(blob)}`);
  }
  for (const rec of Array.isArray(result?.publicRecords) ? result.publicRecords : []) {
    if (!rec) continue;
    const id = rec.docketNumber || rec.caseNumber || rec.type || rec.kind || "record";
    keys.push(`pr:${rec.source || "xx"}:${id}:${rec.type || rec.kind || "record"}`);
  }
  return [...new Set(keys)].sort();
}

/** Dirty = a bureau with at least one negative. Clean = the other of TU/EX/EQ.
 *  An unmapped negative means no bureau is certified clean. */
export function bureauStatusFromResult(result) {
  const dirty = new Set();
  let unknown = false;
  for (const t of Array.isArray(result?.tradelines) ? result.tradelines : []) {
    if (!isNegativeTradeline(t)) continue;
    const code = bureauForTradeline(t, result);
    if (code) dirty.add(code);
    else unknown = true;
  }
  for (const rec of Array.isArray(result?.publicRecords) ? result.publicRecords : []) {
    if (!rec) continue;
    const code = bureauOf(rec.source || rec.bureau || rec.sourceType);
    if (code) dirty.add(code);
    else unknown = true;
  }
  const dirtyList = [...dirty].sort();
  const clean = unknown ? [] : BUREAU_CODES.filter((c) => !dirty.has(c)).sort();
  return { dirty: dirtyList, clean, unknown };
}

export function pauseTaskBody({ dirty, clean } = {}) {
  const dirtyLabel = dirty?.length ? dirty.join(", ") : "none named";
  const cleanLabel = clean?.length ? clean.join(", ") : "none";
  const choice = clean?.length
    ? "They can fund on the clean bureaus if they choose."
    : "No bureau is clean, so funding on a clean bureau is not available.";
  return [
    `Dirty bureaus: ${dirtyLabel}. Clean bureaus: ${cleanLabel}.`,
    choice,
    "Or sell discounted repair — same contract, API pay link.",
    "Gate stays closed until a clean snapshot or a staff release."
  ].join(" ");
}

function isPaused(cf = {}, tags = []) {
  return cf.round_hold_reason === FUNDING_PAUSED_HOLD
    || (Array.isArray(tags) && tags.includes(PAUSED_TAG));
}

function wasInPauseChain(cf = {}, tags = []) {
  return isPaused(cf, tags)
    || !!cf.crs_pause_bureaus
    || !!cf.funding_pause_release
    || (Array.isArray(cf.funding_pause_releases) && cf.funding_pause_releases.length > 0);
}

async function loadClientPauseState(db, clientId) {
  const row = await db.query(
    `SELECT custom_fields, tags FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  return {
    cf: row.rows[0]?.custom_fields || {},
    tags: row.rows[0]?.tags || []
  };
}

async function clearFundingPause(db, clientId, extra = {}) {
  await mergeCustomFields(db, clientId, {
    round_hold_reason: null,
    employee_next_action: "Review Funding File",
    ...extra
  });
  await removeTags(db, clientId, [PAUSED_TAG]);
}

export async function detectAndPauseFunding(db, {
  orgId, clientId, crsResultId, eventId
} = {}) {
  if (!orgId || !clientId || !crsResultId) {
    return { fired: false, reason: "missing_ids" };
  }
  const loaded = await db.query(`SELECT result FROM crs_results WHERE id = $1 LIMIT 1`, [crsResultId]);
  const result = loaded.rows[0]?.result;
  if (!result) return { fired: false, reason: "no_crs_result" };

  const keys = negativeKeysFromResult(result);
  const bureaus = bureauStatusFromResult(result);
  const { cf, tags } = await loadClientPauseState(db, clientId);
  const prior = Array.isArray(cf.crs_negative_keys) ? cf.crs_negative_keys : [];
  const baselineSet = cf.crs_negative_baseline_set === true;
  const paused = isPaused(cf, tags);

  await mergeCustomFields(db, clientId, {
    crs_negative_keys: keys,
    crs_negative_baseline_set: true,
    crs_pause_bureaus: bureaus
  });

  if (!baselineSet) return { fired: false, reason: "first_snapshot", keys, bureaus };

  if (paused && keys.length === 0) {
    await clearFundingPause(db, clientId);
    const task = await createTask(db, {
      orgId,
      clientId,
      title: "CRS snapshot is clean — funding gate reopened",
      sourceWorkflow: RECOVERY_WORKFLOW,
      assigneeRole: "closer",
      eventId: eventId || `ax07-reopen:${clientId}:${crsResultId}`,
      body: "No negatives on this snapshot. Gate is open. Start a new funding round if they still want funding — do not resume the paused one."
    });
    return { fired: false, reopened: true, reason: "clean_snapshot", keys, bureaus, task };
  }

  const added = keys.filter((k) => !prior.includes(k));
  if (!added.length) return { fired: false, reason: "no_new_negatives", keys, bureaus };

  await mergeCustomFields(db, clientId, {
    round_hold_reason: FUNDING_PAUSED_HOLD,
    employee_next_action: "Review New Negative"
  });
  await addTags(db, clientId, [PAUSED_TAG]);
  const task = await createTask(db, {
    orgId,
    clientId,
    title: "New negative on CRS — funding paused",
    sourceWorkflow: SOURCE_WORKFLOW,
    assigneeRole: "closer",
    eventId: eventId || `ax07:${clientId}:${crsResultId}`,
    body: pauseTaskBody(bureaus)
  });
  const email = await sendTemplated(db, {
    orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId
  });
  const sms = await sendTemplated(db, {
    orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId
  });

  return { fired: true, added, keys, bureaus, task, email, sms };
}

export async function releaseFundingPause(db, {
  orgId, clientId, staffId, route = RELEASE_ROUTE_CLEAN_BUREAUS
} = {}) {
  if (!clientId || !staffId) return { ok: false, reason: "missing_ids" };
  const { cf, tags } = await loadClientPauseState(db, clientId);
  if (!isPaused(cf, tags)) return { ok: false, reason: "not_paused" };
  const clean = Array.isArray(cf.crs_pause_bureaus?.clean) ? cf.crs_pause_bureaus.clean : [];
  if (!clean.length) return { ok: false, reason: "no_clean_bureau" };

  const release = {
    staff_id: staffId,
    at: new Date().toISOString(),
    route,
    org_id: orgId || null,
    clean
  };
  const prior = Array.isArray(cf.funding_pause_releases) ? cf.funding_pause_releases : [];
  await clearFundingPause(db, clientId, {
    funding_pause_release: release,
    funding_pause_releases: [...prior, release]
  });
  return { ok: true, release };
}

export async function offerDiscountedRepair(db, {
  orgId, clientId, staffId, amountCents, createPaymentLinkImpl = createPaymentLink
} = {}) {
  if (!orgId || !clientId) return { ok: false, reason: "missing_ids" };
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    return { ok: false, reason: "amount_required" };
  }
  const offer = getOffer("REPAIR_DFY");
  if (!offer) return { ok: false, reason: "offer_missing" };
  const link = await createPaymentLinkImpl(db, {
    orgId,
    clientId,
    purpose: offer.paymentPurpose,
    description: offer.name,
    amountCents,
    createdByStaffId: staffId || null,
    productCode: offer.productCode
  });
  const { cf, tags } = await loadClientPauseState(db, clientId);
  await mergeCustomFields(db, clientId, {
    funding_pause_repair_offer: {
      staff_id: staffId || null,
      at: new Date().toISOString(),
      amount_cents: amountCents,
      offer_key: offer.key,
      contract_template_key: offer.contractTemplateKey || null
    }
  });
  return {
    ok: true,
    link,
    offerKey: offer.key,
    contractTemplateKey: offer.contractTemplateKey,
    gateClosed: isPaused(cf, tags)
  };
}

export async function requestFreshReassessment(db, {
  orgId, clientId, eventId
} = {}) {
  if (!orgId || !clientId) return { ok: false, reason: "missing_ids" };
  const { cf, tags } = await loadClientPauseState(db, clientId);
  if (!wasInPauseChain(cf, tags)) return { ok: false, reason: "not_paused_client" };
  const task = await createTask(db, {
    orgId,
    clientId,
    title: "Re-pull CRS and re-underwrite — new round",
    sourceWorkflow: RECOVERY_WORKFLOW,
    assigneeRole: "closer",
    eventId: eventId || `ax07-reassess:${clientId}`,
    body: "Repair finished. Pull a new CRS and start a new funding round. Do not reopen or renumber the paused round."
  });
  return { ok: true, task, resumedPausedRound: false };
}

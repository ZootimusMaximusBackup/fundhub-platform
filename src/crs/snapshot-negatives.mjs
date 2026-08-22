// CRS snapshot negative-item keys + AX-07 pause. Spec 4.11 (2026-08-22).
// Diff lives on top of u-03. Do not build a second snapshot pipeline.

import { mergeCustomFields } from "../workflows/custom-fields.mjs";
import { addTags } from "../workflows/tags.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";
import { createTask } from "../lib/create-task.mjs";
import { FUNDING_PAUSED_HOLD } from "../inquiry-ops/doc-gate.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-AX07-FUNDING-PAUSED";
export const SMS_TEMPLATE_KEY = "SMS-AX07-FUNDING-PAUSED";
export const SOURCE_WORKFLOW = "ax-07-funding-paused";

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

export function negativeKeysFromResult(result) {
  const keys = [];
  for (const t of Array.isArray(result?.tradelines) ? result.tradelines : []) {
    const blob = blobOf(t);
    const flagged = t?.collectionIndicator === true || t?.derogatoryIndicator === true || NEGATIVE_RE.test(blob);
    if (!flagged) continue;
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
  const cfRow = await db.query(`SELECT custom_fields FROM clients WHERE id = $1 LIMIT 1`, [clientId]);
  const cf = cfRow.rows[0]?.custom_fields || {};
  const prior = Array.isArray(cf.crs_negative_keys) ? cf.crs_negative_keys : [];
  const baselineSet = cf.crs_negative_baseline_set === true;

  await mergeCustomFields(db, clientId, {
    crs_negative_keys: keys,
    crs_negative_baseline_set: true
  });

  if (!baselineSet) return { fired: false, reason: "first_snapshot", keys };
  const added = keys.filter((k) => !prior.includes(k));
  if (!added.length) return { fired: false, reason: "no_new_negatives", keys };

  await mergeCustomFields(db, clientId, {
    round_hold_reason: FUNDING_PAUSED_HOLD,
    employee_next_action: "Review New Negative"
  });
  await addTags(db, clientId, ["funding:paused"]);
  const task = await createTask(db, {
    orgId,
    clientId,
    title: "New negative on CRS — funding paused",
    sourceWorkflow: SOURCE_WORKFLOW,
    assigneeRole: "closer",
    eventId: eventId || `ax07:${clientId}:${crsResultId}`,
    body: added.join(", ")
  });
  const email = await sendTemplated(db, {
    orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId
  });
  const sms = await sendTemplated(db, {
    orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId
  });

  return { fired: true, added, keys, task, email, sms };
}

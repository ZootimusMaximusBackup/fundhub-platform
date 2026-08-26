import { parseResponseText } from "../metro2/inbound/parse-response.mjs";
import { confirmParse } from "../metro2/inbound/confirm.mjs";
import { onRepairEvent } from "./handlers.mjs";

const OPENISH = new Set(["open", "sent", "unaddressed", "escalated", "verified"]);
export const AUTO_THRESHOLD = 0.85;
const STAFF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function staffIdOrNull(value) {
  return typeof value === "string" && STAFF_UUID.test(value.trim()) ? value.trim() : null;
}

export async function loadOpenDisputeItems(db, { orgId, clientId }) {
  if (!db) return [];
  const r = await db.query(
    `SELECT di.id, di.case_id, di.org_id, di.client_id, di.creditor, di.account_last4,
            di.round, di.status, di.rule_id, di.outcome, dc.bureau
       FROM dispute_items di
       JOIN dispute_cases dc ON dc.id = di.case_id
      WHERE di.org_id = $1 AND di.client_id = $2
        AND di.status = ANY($3::text[])
      ORDER BY di.created_at ASC`,
    [orgId, clientId, [...OPENISH]]
  );
  return r.rows || [];
}

export async function persistAdvancedItems(db, items = []) {
  if (!db || !items.length) return { updated: 0 };
  let updated = 0;
  for (const it of items) {
    if (!it?.id) continue;
    await db.query(
      `UPDATE dispute_items SET status = $2, round = $3, outcome = $4, updated_at = now() WHERE id = $1`,
      [it.id, it.status, it.round, it.outcome || null]
    );
    updated += 1;
  }
  return { updated };
}

export async function insertDisputeResponse(db, {
  orgId, clientId, caseId, rawText, parseResult, confirmed = false, confirmedBy = null
}) {
  if (!db) return null;
  const r = await db.query(
    `INSERT INTO dispute_responses
       (case_id, org_id, client_id, raw_text, parse_json, confidence, confirmed, confirmed_at, confirmed_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7, CASE WHEN $7 THEN now() ELSE NULL END, $8)
     RETURNING *`,
    [caseId, orgId, clientId, rawText || null, JSON.stringify(parseResult || {}),
     parseResult?.confidence ?? null, !!confirmed, staffIdOrNull(confirmedBy)]
  );
  return r.rows[0] || null;
}

export async function runParseAdvanceLoop(db, {
  orgId, clientId, text, items: itemsIn = null,
  autoConfirmThreshold = AUTO_THRESHOLD,
  confirmedBy = null,
  onEvent = onRepairEvent
} = {}) {
  const items = itemsIn || await loadOpenDisputeItems(db, { orgId, clientId });
  const parseResult = parseResponseText({ text, items });
  const caseId = items[0]?.case_id || items[0]?.caseId || null;
  if (!caseId) return { ok: false, reason: "no_open_items", parseResult, status: "skipped" };

  const needsHuman = parseResult.needsConfirm || Number(parseResult.confidence) < autoConfirmThreshold;
  if (needsHuman) {
    const row = await insertDisputeResponse(db, { orgId, clientId, caseId, rawText: text, parseResult, confirmed: false });
    if (db && typeof onEvent === "function") {
      await onEvent(db, { name: "repair.parse.low_confidence", orgId, clientId,
        payload: { response_id: row?.id || null, confidence: parseResult.confidence, case_id: caseId } });
    }
    return { ok: true, status: "held", event: "repair.parse.low_confidence", parseResult, responseId: row?.id || null, advanced: null };
  }

  const confirmed = await confirmParse(db, {
    orgId, clientId, caseId, items, parseResult,
    confirmedOutcomes: parseResult.outcomes, confirmedBy, threshold: autoConfirmThreshold
  });
  if (confirmed.ok) {
    await persistAdvancedItems(db, confirmed.items || []);
    const row = await insertDisputeResponse(db, {
      orgId, clientId, caseId, rawText: text, parseResult, confirmed: true, confirmedBy
    });
    if (db && typeof onEvent === "function") {
      await onEvent(db, { name: "repair.response.parsed", orgId, clientId,
        payload: { response_id: row?.id || null, confidence: parseResult.confidence, case_id: caseId, log: confirmed.log || [] } });
    }
    return { ok: true, status: "advanced", event: "repair.response.parsed", parseResult, responseId: row?.id || null, advanced: confirmed };
  }
  const row = await insertDisputeResponse(db, { orgId, clientId, caseId, rawText: text, parseResult, confirmed: false });
  return { ok: true, status: "held", event: "repair.parse.low_confidence", parseResult, responseId: row?.id || null, advanced: null, confirmReason: confirmed.reason || null };
}

export async function confirmHeldParse(db, {
  orgId, responseId, confirmedBy, confirmedOutcomes = null, onEvent = onRepairEvent
} = {}) {
  if (!db || !responseId) return { ok: false, reason: "missing_args" };
  const r = await db.query(`SELECT * FROM dispute_responses WHERE id = $1 AND org_id = $2`, [responseId, orgId]);
  const row = r.rows[0];
  if (!row) return { ok: false, reason: "not_found" };
  if (row.confirmed) return { ok: true, status: "already_confirmed", responseId };
  const parseResult = row.parse_json && typeof row.parse_json === "object"
    ? row.parse_json
    : { outcomes: [], confidence: Number(row.confidence) || 0, needsConfirm: true };
  const items = await loadOpenDisputeItems(db, { orgId, clientId: row.client_id });
  const caseItems = items.filter((it) => String(it.case_id) === String(row.case_id));
  const useItems = caseItems.length ? caseItems : items;
  const outcomes = confirmedOutcomes || parseResult.outcomes || [];
  const confirmed = await confirmParse(db, {
    orgId, clientId: row.client_id, caseId: row.case_id, items: useItems,
    parseResult: { ...parseResult, confidence: 1 }, confirmedOutcomes: outcomes, confirmedBy, threshold: AUTO_THRESHOLD
  });
  if (!confirmed.ok) return { ok: false, reason: confirmed.reason || "confirm_failed", confirmed };
  await persistAdvancedItems(db, confirmed.items || []);
  await db.query(
    `UPDATE dispute_responses SET confirmed = true, confirmed_at = now(), confirmed_by = $2 WHERE id = $1 AND org_id = $3`,
    [responseId, staffIdOrNull(confirmedBy), orgId]
  );
  if (typeof onEvent === "function") {
    await onEvent(db, { name: "repair.response.parsed", orgId, clientId: row.client_id,
      payload: { response_id: responseId, confidence: parseResult.confidence, case_id: row.case_id, confirmed_by: confirmedBy || null, log: confirmed.log || [] } });
  }
  return { ok: true, status: "advanced", event: "repair.response.parsed", responseId, advanced: confirmed };
}

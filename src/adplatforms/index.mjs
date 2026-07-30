// The platform write path — the ordering that makes the whole module safe.
//
// EVERY WRITE GOES: GUARDRAIL → ACTION LOG → PLATFORM. In that order, with no
// exceptions and no way to skip a step.
//
//   guardrail first, because a payload that fails compliance must never reach a
//   platform, and checking afterwards means it already has.
//
//   action log SECOND — before the call, not after. If we logged after, a crash
//   or timeout mid-flight would leave a change that exists on the platform and
//   nowhere in our records: unfindable, un-auditable, and un-undoable. Logging
//   first means the worst case is a logged action that did not happen, which is
//   noisy but recoverable. The row is stamped with executed_at afterwards, so
//   "logged but never executed" is queryable.
//
//   platform last, and its error is captured verbatim.
//
// PLATFORM ERRORS ARE NEVER SWALLOWED. A policy rejection is the single most
// useful thing a platform tells us, and paraphrasing it into "campaign creation
// failed" strips the partner of the only information that would let them fix it.
// So last_error holds the platform's own message and the dashboard shows it.

import { screen } from "../compliance/screen.mjs";
import { checkBudgetWrite } from "../optimize/ceilings.mjs";
import * as meta from "./meta.mjs";
import * as tiktok from "./tiktok.mjs";

const ADAPTERS = { meta, tiktok };

export function adapterFor(platform) {
  const a = ADAPTERS[platform];
  if (!a) {
    throw new Error(
      `no ad platform adapter for "${platform}". Known: ${Object.keys(ADAPTERS).join(", ")}. ` +
      `google is a valid connection platform but has no write adapter yet.`
    );
  }
  return a;
}

/* guardedWrite — the wrapper every platform write uses.

   Returns { ok, result, actionLogId, reasons }. Never throws for a compliance
   block or a ceiling denial: those are outcomes the caller renders, not
   exceptions. It DOES throw for programming errors, which are bugs. */
export async function guardedWrite(tx, {
  orgId, partnerId, platform,
  targetType, targetId,
  ruleKey = null, reason, actor = "human", agentId = null, userId = null,
  // The compliance subject. Omitted only for operations that carry no creative
  // and no targeting — pause and resume.
  screenSubject = null,
  // Budget writes name their ceiling scope so the money check runs.
  budget = null,
  before = {}, after = {}, undoPayload = null,
  metrics = {},
  execute
} = {}) {
  if (typeof execute !== "function") throw new Error("guardedWrite: execute is required");
  if (!orgId || !partnerId) throw new Error("guardedWrite: orgId and partnerId are required");
  if (!reason) throw new Error("guardedWrite: reason is required — an unexplained action is not auditable");
  if (actor === "agent" && (!ruleKey || !undoPayload)) {
    // Mirrors the CHECK in 046. Caught here too so the failure names the missing
    // argument rather than surfacing as a constraint violation.
    throw new Error("guardedWrite: an agent action must carry ruleKey and undoPayload");
  }

  // ---- 1. GUARDRAIL -------------------------------------------------------
  if (screenSubject) {
    const verdict = await screen(tx, { ...screenSubject, orgId, partnerId, platform });
    if (verdict.state !== "passed") {
      // needs_approval is NOT a pass. Nothing reaches a platform in that state.
      return { ok: false, blocked: true, state: verdict.state, reasons: verdict.reasons };
    }
  }

  // ---- 2. MONEY -----------------------------------------------------------
  if (budget) {
    const check = await checkBudgetWrite(tx, {
      partnerId, platform,
      campaignId: budget.campaignId ?? null,
      currentBudgetCents: budget.currentCents,
      proposedBudgetCents: budget.proposedCents
    });
    if (!check.allowed) {
      return { ok: false, blocked: true, state: "over_ceiling", reasons: check.reasons };
    }
  }

  // ---- 3. LOG, BEFORE THE CALL -------------------------------------------
  const { rows: logged } = await tx.query(
    `INSERT INTO action_log
       (org_id, partner_id, actor, agent_id, user_id, target_type, target_id,
        rule_key, reason, metrics_snapshot, before, after, undo_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb)
     RETURNING id`,
    [orgId, partnerId, actor, agentId, userId, targetType, targetId,
     ruleKey, reason, JSON.stringify(metrics), JSON.stringify(before),
     JSON.stringify(after), undoPayload ? JSON.stringify(undoPayload) : null]
  );
  const actionLogId = logged[0].id;

  // ---- 4. PLATFORM --------------------------------------------------------
  try {
    const result = await execute();
    await tx.query(`UPDATE action_log SET executed_at = now() WHERE id = $1`, [actionLogId]);
    return { ok: true, result, actionLogId };
  } catch (err) {
    // The platform's own words, verbatim and untruncated below 2000 chars. A
    // policy rejection paraphrased is a policy rejection the partner cannot act on.
    const platformMessage = String(err?.platformMessage || err?.message || err).slice(0, 2000);
    await tx.query(
      `UPDATE action_log SET executed_at = now(), execute_error = $2 WHERE id = $1`,
      [actionLogId, platformMessage]);

    if (targetType === "campaign" && targetId) {
      await tx.query(`UPDATE campaigns SET last_error = $2 WHERE id = $1`, [targetId, platformMessage]);
    }
    return { ok: false, error: platformMessage, actionLogId, reasons: [{ code: "platform_error", message: platformMessage }] };
  }
}

/* undo(tx, actionLogId, ctx) → { ok, ... }

   Replays an action's undo_payload. Idempotent: an already-undone action returns
   ok without calling the platform again, so a double-click cannot double-revert.
   The undo itself is logged as a human action, because a revert is a decision. */
export async function undo(tx, actionLogId, { userId = null, execute } = {}) {
  const { rows } = await tx.query(
    `SELECT * FROM action_log WHERE id = $1`, [actionLogId]);
  const row = rows[0];
  if (!row) { const e = new Error("action not found"); e.code = "NOT_FOUND"; throw e; }

  if (row.undone_at) return { ok: true, alreadyUndone: true };
  if (!row.undo_payload) {
    return { ok: false, reasons: [{ code: "not_revertible", message: "this action carries no undo payload" }] };
  }

  if (typeof execute === "function") await execute(row.undo_payload, row);

  await tx.query(
    `UPDATE action_log SET undone_at = now(), undone_by = $2 WHERE id = $1`,
    [actionLogId, userId]);

  // The revert is itself an auditable event, attributed to the person who did it.
  await tx.query(
    `INSERT INTO action_log
       (org_id, partner_id, actor, user_id, target_type, target_id, reason, before, after, undo_payload)
     VALUES ($1,$2,'human',$3,$4,$5,$6,$7::jsonb,$8::jsonb,NULL)`,
    [row.org_id, row.partner_id, userId, row.target_type, row.target_id,
     `revert of action ${actionLogId} (${row.rule_key || "manual"})`,
     JSON.stringify(row.after), JSON.stringify(row.before)]
  );

  return { ok: true, reverted: actionLogId };
}

export { meta, tiktok };
export default { adapterFor, guardedWrite, undo };

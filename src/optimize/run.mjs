// The daily optimisation loop — one idempotent job per partner per day.
//
// IDEMPOTENT BY CONSTRUCTION, not by a flag. Before acting, the loop checks
// action_log for a row with the same (partner, target, rule_key) on today's date.
// A second run of the same day finds its own earlier rows and does nothing. That
// matters because the alternative — a "has run today" boolean — is one crashed
// job away from either never running again or running twice.
//
// EVERY ACTION GOES THROUGH guardedWrite, so every one of them is logged BEFORE it
// executes, carries the rule that fired and the metrics that triggered it, and
// carries an undo payload. No path in this module writes to a platform directly.
//
// AUTOPILOT IS A PARTNER-CONTROLLED SWITCH. autopilot_enabled defaults to FALSE,
// so a partner is opted out until they opt in, and autopilot_paused_at is the
// one-click stop. Checked once at the top: a loop that checked per-action could
// half-run while a partner was trying to stop it.

import { evaluate, stepBackUp } from "./rules.mjs";
import { guardedWrite } from "../adplatforms/index.mjs";
import { capIncrease } from "./ceilings.mjs";

/* runDailyOptimization(tx, req) → { ran, skipped, actions[] } */
export async function runDailyOptimization(tx, {
  orgId, partnerId, agentId = null, platformCall = null, today = null, lookbackDays = 7
} = {}) {
  if (!orgId || !partnerId) throw new Error("runDailyOptimization: orgId and partnerId are required");

  const settings = (await tx.query(
    `SELECT autopilot_enabled, autopilot_paused_at FROM partner_module_settings WHERE partner_id = $1`,
    [partnerId])).rows[0];

  // Default OFF when there is no settings row. A partner who has never configured
  // the module has not consented to automated spending changes.
  if (!settings?.autopilot_enabled) {
    return { ran: false, skipped: "autopilot_disabled", actions: [] };
  }
  if (settings.autopilot_paused_at) {
    return { ran: false, skipped: "autopilot_paused", actions: [] };
  }

  const rules = await loadRules(tx, orgId);
  const maxIncreasePct = await maxIncreaseFor(tx, partnerId);
  const adSets = await liveAdSets(tx, partnerId);

  const actions = [];
  for (const adSet of adSets) {
    const series = await seriesFor(tx, adSet.id, { lookbackDays, today });

    const proposals = [
      ...evaluate({ adSet, series, rules, maxIncreasePct }),
      stepBackUp({ adSet, series, params: rules.cpa_over_target?.params || {}, maxIncreasePct })
    ].filter(Boolean);

    for (const p of proposals) {
      if (p.action === "none") continue;

      // The idempotency check. Same partner, same target, same rule, same day.
      if (await alreadyActedToday(tx, { partnerId, targetId: adSet.id, ruleKey: p.rule_key, today })) {
        actions.push({ ...p, skipped: "already_acted_today" });
        continue;
      }

      actions.push(await execute(tx, {
        orgId, partnerId, agentId, adSet, proposal: p, series, platformCall, maxIncreasePct
      }));
    }
  }

  return { ran: true, actions };
}

async function execute(tx, { orgId, partnerId, agentId, adSet, proposal, series, platformCall, maxIncreasePct }) {
  const isBudget = proposal.action === "increase_budget" || proposal.action === "decrease_budget";

  // The undo payload restores the exact prior state. Recorded from the row we
  // read, not recomputed at undo time — a recomputed "previous budget" would be
  // wrong the moment anything else changed it in between.
  const undoPayload = isBudget
    ? { action: "set_budget", ad_set_id: adSet.id, budget_cents: Number(adSet.budget_cents),
        external_id: adSet.external_id }
    : proposal.action === "pause"
      ? { action: "resume", ad_set_id: adSet.id, external_id: adSet.external_id }
      : { action: "noop", note: `${proposal.action} queues work; reverting means discarding the queued item`,
          ad_set_id: adSet.id };

  // Belt to the ceiling check inside guardedWrite: propose a number that is
  // already legal, so a rejection means a genuine ceiling breach rather than the
  // rule and the cap disagreeing.
  const proposed = isBudget
    ? (proposal.action === "increase_budget"
        ? Math.min(proposal.to_budget_cents, capIncrease(adSet.budget_cents, maxIncreasePct))
        : proposal.to_budget_cents)
    : null;

  const res = await guardedWrite(tx, {
    orgId, partnerId, platform: adSet.platform,
    targetType: "ad_set", targetId: adSet.id,
    actor: "agent", agentId,
    ruleKey: proposal.rule_key,
    reason: proposal.reason,
    metrics: { ...(proposal.metrics || {}), series_days: series.length },
    before: { budget_cents: Number(adSet.budget_cents), approval_state: adSet.approval_state },
    after: isBudget ? { budget_cents: proposed }
         : proposal.action === "pause" ? { approval_state: "paused" }
         : { queued: proposal.action },
    undoPayload,
    budget: isBudget
      ? { campaignId: adSet.campaign_id, currentCents: Number(adSet.budget_cents), proposedCents: proposed }
      : null,
    execute: async () => {
      if (isBudget) {
        await tx.query(`UPDATE ad_sets SET budget_cents = $2 WHERE id = $1`, [adSet.id, proposed]);
        if (platformCall) await platformCall({ op: "updateBudget", adSet, budgetCents: proposed });
        return { budget_cents: proposed };
      }
      if (proposal.action === "pause") {
        await tx.query(`UPDATE ad_sets SET approval_state = 'paused' WHERE id = $1`, [adSet.id]);
        if (platformCall) await platformCall({ op: "pause", adSet });
        return { paused: true };
      }
      if (proposal.action === "rotate_creative" || proposal.action === "refresh_creative") {
        // Stamping rotated_at is what makes the 72-hour cadence hold across runs.
        await tx.query(`UPDATE ads SET rotated_at = now() WHERE ad_set_id = $1`, [adSet.id]);
      }
      // queue_creative and refresh_creative are requests for generation, not
      // platform writes. The generation service picks them up.
      return { queued: proposal.action };
    }
  });

  return { ...proposal, ok: res.ok, actionLogId: res.actionLogId, blocked: res.blocked, reasons: res.reasons };
}

/* alreadyActedToday — the idempotency guard.

   Scoped to the rule AND the target, so two different rules acting on one ad set
   in a day is fine, and the same rule acting twice is not. */
async function alreadyActedToday(tx, { partnerId, targetId, ruleKey, today }) {
  const { rows } = await tx.query(
    `SELECT 1 FROM action_log
      WHERE partner_id = $1 AND target_id = $2 AND rule_key = $3
        AND created_at >= date_trunc('day', COALESCE($4::timestamptz, now()))
        AND created_at <  date_trunc('day', COALESCE($4::timestamptz, now())) + interval '1 day'
      LIMIT 1`,
    [partnerId, targetId, ruleKey, today]
  );
  return rows.length > 0;
}

async function loadRules(tx, orgId) {
  const { rows } = await tx.query(
    `SELECT rule_key, params, active FROM optimization_rules WHERE org_id = $1`, [orgId]);
  return Object.fromEntries(rows.map((r) => [r.rule_key, { active: r.active, params: r.params || {} }]));
}

/* maxIncreaseFor — the TIGHTEST applicable ceiling's cap, never the loosest.
   Falls back to 20 (the spec's seed) when a partner has no ceiling rows, and the
   30 hard cap is enforced downstream by capIncrease and by the CHECK in 046. */
async function maxIncreaseFor(tx, partnerId) {
  const { rows } = await tx.query(
    `SELECT min(max_daily_increase_pct) AS pct FROM spend_ceilings
      WHERE partner_id = $1 AND active`, [partnerId]);
  const pct = rows[0]?.pct;
  return pct === null || pct === undefined ? 20 : Number(pct);
}

async function liveAdSets(tx, partnerId) {
  const { rows } = await tx.query(
    `SELECT s.id, s.campaign_id, s.budget_cents, s.learning_until, s.approval_state,
            s.external_id, c.platform,
            (SELECT max(a.rotated_at) FROM ads a WHERE a.ad_set_id = s.id) AS rotated_at
       FROM ad_sets s
       JOIN campaigns c ON c.id = s.campaign_id
      WHERE s.partner_id = $1 AND s.approval_state = 'live'
      ORDER BY s.created_at`,
    [partnerId]);
  return rows;
}

/* seriesFor — oldest first, because every rule reads the tail as "most recent".
   Reversing this would silently invert every consecutive-days check. */
async function seriesFor(tx, adSetId, { lookbackDays, today }) {
  const { rows } = await tx.query(
    `SELECT m.date,
            sum(m.spend_cents)::bigint AS spend_cents,
            sum(m.conversions)::bigint AS conversions,
            avg(m.roas)                AS roas,
            avg(m.cpa_cents)           AS cpa_cents,
            avg(m.ctr)                 AS ctr,
            avg(m.frequency)           AS frequency
       FROM ad_metrics_daily m
       JOIN ads a ON a.id = m.ad_id
      WHERE a.ad_set_id = $1
        AND m.date > COALESCE($3::date, CURRENT_DATE) - ($2::int || ' days')::interval
        AND m.date <= COALESCE($3::date, CURRENT_DATE)
      GROUP BY m.date
      ORDER BY m.date ASC`,
    [adSetId, lookbackDays, today]);
  return rows.map((r) => ({
    date: r.date,
    spend_cents: Number(r.spend_cents),
    conversions: Number(r.conversions),
    roas: r.roas === null ? null : Number(r.roas),
    cpa_cents: r.cpa_cents === null ? null : Number(r.cpa_cents),
    ctr: r.ctr === null ? null : Number(r.ctr),
    frequency: r.frequency === null ? null : Number(r.frequency)
  }));
}

export default runDailyOptimization;

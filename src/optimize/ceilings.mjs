// Spend ceilings — the money invariant.
//
// THREE SCOPES, ALL CHECKED, ALWAYS. Daily per partner, per campaign, per
// platform. Not "the tightest one" and not "the one that applies" — every ceiling
// whose scope matches is evaluated, because they exist to catch different
// failures: a partner ceiling catches a runaway across many campaigns, a campaign
// ceiling catches one campaign eating the whole budget, and a platform ceiling
// catches a bad integration hammering one API.
//
// TWO INDEPENDENT ENFORCEMENT POINTS, and the independence is the point:
//
//   1. PRE-FLIGHT (checkBudgetWrite) — before any budget write. Reads our own
//      mirror of what we believe is being spent.
//   2. KILL SWITCH (runKillSwitch) — a separate job reading ACTUAL platform spend.
//
// If the pre-flight check were the only guard, then any bug that made our mirror
// under-report — a failed sync, a dropped webhook, a timezone error at the day
// boundary — would silently raise the real ceiling to infinity. The kill switch
// reads the platform's own numbers precisely so it does not share that failure
// mode. A single check that consulted both would not be two checks; it would be
// one check with two inputs and one bug away from neither working.
//
// THE INCREASE CAP IS SEPARATE FROM THE CEILING. A budget can be well under the
// daily ceiling and still be an illegal move if it jumps more than
// max_daily_increase_pct in one step. Hard cap 30, enforced by a CHECK in 046 as
// well as here, so no config edit can exceed it.

const HARD_CAP_PCT = 30;

/* checkBudgetWrite(tx, req) → { allowed, reasons[], ceilings[] }

   Called before ANY budget write, automated or human. Fails closed: if the
   ceilings cannot be read, nothing is allowed through. */
export async function checkBudgetWrite(tx, {
  partnerId, campaignId = null, platform = null,
  currentBudgetCents, proposedBudgetCents
} = {}) {
  const reasons = [];

  if (!partnerId) throw new Error("checkBudgetWrite: partnerId is required");
  const proposed = Number(proposedBudgetCents);
  if (!Number.isFinite(proposed) || proposed < 0) {
    return deny("invalid_budget", `proposed budget ${proposedBudgetCents} is not a non-negative number`);
  }

  const { rows: ceilings } = await tx.query(
    `SELECT id, scope, campaign_id, platform, daily_limit_cents, max_daily_increase_pct,
            breached_at, breach_reason
       FROM spend_ceilings
      WHERE partner_id = $1 AND active
        AND (scope = 'partner'
             OR (scope = 'campaign' AND campaign_id = $2)
             OR (scope = 'platform' AND platform   = $3))`,
    [partnerId, campaignId, platform]
  );

  // NO CEILING IS A DENY, NOT AN ALLOW. An unconfigured partner is one nobody has
  // set limits for, and letting automation spend without a ceiling because none
  // was configured is precisely backwards.
  if (!ceilings.length) {
    return deny("no_ceiling_configured",
      "no active spend ceiling applies to this write — configure one before spending");
  }

  // A tripped kill switch blocks every budget write until a human clears it.
  for (const c of ceilings.filter((x) => x.breached_at)) {
    reasons.push({
      code: "ceiling_breached",
      ceiling_id: c.id,
      message: `the ${c.scope} ceiling is in a breached state (${c.breach_reason}) — clear it before spending`
    });
  }

  // Today's spend for each applicable scope, from our mirror.
  const spend = await spendToday(tx, { partnerId, campaignId, platform });

  for (const c of ceilings) {
    const scopeSpend = c.scope === "campaign" ? spend.campaign
      : c.scope === "platform" ? spend.platform
      : spend.partner;

    // The write is judged on what the day would TOTAL, not on the delta. A
    // campaign already at the ceiling must not be allowed a further raise just
    // because the increment is small.
    const projected = scopeSpend - Number(currentBudgetCents || 0) + proposed;
    if (projected > Number(c.daily_limit_cents)) {
      reasons.push({
        code: "over_ceiling",
        ceiling_id: c.id,
        scope: c.scope,
        message: `${c.scope} ceiling: projected ${projected} exceeds the daily limit of ${c.daily_limit_cents}`,
        limit_cents: Number(c.daily_limit_cents),
        projected_cents: projected
      });
    }
  }

  // The increase cap, from the tightest applicable ceiling.
  const current = Number(currentBudgetCents || 0);
  if (current > 0 && proposed > current) {
    const capPct = Math.min(
      HARD_CAP_PCT,
      ...ceilings.map((c) => Number(c.max_daily_increase_pct ?? HARD_CAP_PCT))
    );
    const increasePct = ((proposed - current) / current) * 100;
    // Rounded to 4dp before comparing: a 20.000000000000004% increase computed
    // from integer cents is a floating-point artefact, not a policy violation.
    if (Math.round(increasePct * 1e4) / 1e4 > capPct) {
      reasons.push({
        code: "increase_too_large",
        message: `raising the budget ${increasePct.toFixed(2)}% exceeds max_daily_increase_pct of ${capPct}`,
        increase_pct: increasePct,
        cap_pct: capPct
      });
    }
  }

  return { allowed: reasons.length === 0, reasons, ceilings };
}

/* spendToday — our mirror's view, per scope. */
async function spendToday(tx, { partnerId, campaignId, platform }) {
  const { rows } = await tx.query(
    `SELECT
       COALESCE(sum(m.spend_cents), 0)                                            AS partner,
       COALESCE(sum(m.spend_cents) FILTER (WHERE a.campaign_id = $2), 0)          AS campaign,
       COALESCE(sum(m.spend_cents) FILTER (WHERE c.platform    = $3), 0)          AS platform
       FROM ad_metrics_daily m
       JOIN ads a       ON a.id = m.ad_id
       JOIN campaigns c ON c.id = a.campaign_id
      WHERE m.partner_id = $1 AND m.date = CURRENT_DATE`,
    [partnerId, campaignId, platform]
  );
  const r = rows[0] || {};
  return {
    partner: Number(r.partner || 0),
    campaign: Number(r.campaign || 0),
    platform: Number(r.platform || 0)
  };
}

/* runKillSwitch(tx, req) → { tripped[], checked }

   THE INDEPENDENT CHECK. Reads ACTUAL spend from the platform rather than from
   ad_metrics_daily, so a sync failure that under-reports cannot disable it.
   `fetchActualSpend` is injected: it is the platform adapter's insights call in
   production and a stub in tests.

   Trips → pause everything in scope, stamp the ceiling, and log. Deliberately
   blunt: this is the last line, and a partial pause that leaves some ads running
   is not a stop. */
export async function runKillSwitch(tx, { partnerId, fetchActualSpend, pausePlatform, agentId = null } = {}) {
  if (typeof fetchActualSpend !== "function") {
    throw new Error("runKillSwitch: fetchActualSpend is required — the point is to NOT trust our own mirror");
  }

  const { rows: ceilings } = await tx.query(
    `SELECT id, org_id, scope, campaign_id, platform, daily_limit_cents, breached_at
       FROM spend_ceilings WHERE partner_id = $1 AND active AND breached_at IS NULL`,
    [partnerId]
  );

  const tripped = [];
  for (const c of ceilings) {
    let actual;
    try {
      actual = Number(await fetchActualSpend({
        partnerId, scope: c.scope, campaignId: c.campaign_id, platform: c.platform
      }));
    } catch (err) {
      // A platform we cannot read is a platform we cannot certify as under its
      // ceiling. Recorded, and deliberately NOT treated as zero spend.
      tripped.push({ ceiling_id: c.id, reason: "unreadable", error: String(err.message).slice(0, 200) });
      continue;
    }
    if (!Number.isFinite(actual)) continue;

    if (actual > Number(c.daily_limit_cents)) {
      const reason =
        `actual platform spend ${actual} exceeded the ${c.scope} ceiling ${c.daily_limit_cents}`;

      // Log BEFORE acting, like every other automated action.
      await tx.query(
        `INSERT INTO action_log
           (org_id, partner_id, actor, agent_id, target_type, target_id, rule_key, reason,
            metrics_snapshot, before, after, undo_payload)
         VALUES ($1,$2,'agent',$3,'campaign',$4,'kill_switch_ceiling',$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb)`,
        [c.org_id, partnerId, agentId, c.campaign_id, reason,
         JSON.stringify({ actual_spend_cents: actual, limit_cents: Number(c.daily_limit_cents) }),
         JSON.stringify({ ceiling_breached: false }),
         JSON.stringify({ ceiling_breached: true }),
         // The undo is deliberately narrow: clearing the breach flag. It does NOT
         // resume the paused campaigns, because "spend went over the ceiling" is
         // not something a one-click revert should undo without a human deciding
         // the ceiling was wrong.
         JSON.stringify({ action: "clear_ceiling_breach", ceiling_id: c.id })]
      );

      await tx.query(
        `UPDATE spend_ceilings SET breached_at = now(), breach_reason = $2 WHERE id = $1`,
        [c.id, reason]);

      if (typeof pausePlatform === "function") {
        await pausePlatform({ partnerId, scope: c.scope, campaignId: c.campaign_id, platform: c.platform });
      }

      // Pause our mirror too, so the dashboard and any other reader agree with
      // the platform rather than showing campaigns as live.
      await tx.query(
        `UPDATE campaigns SET approval_state = 'paused'
          WHERE partner_id = $1 AND approval_state = 'live'
            AND ($2::uuid IS NULL OR id = $2)
            AND ($3::text IS NULL OR platform = $3)`,
        [partnerId, c.scope === "campaign" ? c.campaign_id : null,
         c.scope === "platform" ? c.platform : null]);

      tripped.push({ ceiling_id: c.id, scope: c.scope, actual_cents: actual,
                     limit_cents: Number(c.daily_limit_cents), reason });
    }
  }

  return { tripped, checked: ceilings.length };
}

/* capIncrease — the largest legal next budget. Used by the scale-winner rule so it
   proposes a compliant number rather than proposing one and being rejected. */
export function capIncrease(currentCents, maxPct) {
  const pct = Math.min(Number(maxPct ?? HARD_CAP_PCT), HARD_CAP_PCT);
  return Math.floor(Number(currentCents) * (1 + pct / 100));
}

const deny = (code, message) => ({ allowed: false, reasons: [{ code, message }], ceilings: [] });

export const CEILING_HARD_CAP_PCT = HARD_CAP_PCT;
export default { checkBudgetWrite, runKillSwitch, capIncrease };

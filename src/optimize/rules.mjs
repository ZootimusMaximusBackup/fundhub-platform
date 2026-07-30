// The optimisation rules — pure decision functions, no I/O.
//
// SEPARATED FROM EXECUTION ON PURPOSE. Each rule takes a metrics series and
// returns a proposed action or null. Nothing here writes, calls a platform, or
// reads config; the caller in run.mjs supplies the params and performs the
// action. That makes every threshold testable against a fabricated series without
// a database, which is the only practical way to test "3 consecutive days above
// target" and its off-by-one neighbours.
//
// ROAS IS THE PRIMARY TRIGGER, and roasSuppresses() is where that is enforced
// rather than merely documented. While ROAS is at or above target, the CPA and CTR
// rules may QUEUE creative but must not pause or cut budget. Without this, a
// campaign that is making money at a high CPM gets throttled by a secondary metric
// — the single most common way an automated optimiser destroys a working campaign.
//
// THE LEARNING PHASE IS NEVER TOUCHED. Checked once, at the top of evaluate(), for
// every rule rather than per rule, because a rule added later would otherwise
// default to editing inside it.

/* evaluate(input) → proposals[]

   input: {
     adSet: { id, learning_until, budget_cents },
     series: [{ date, spend_cents, roas, cpa_cents, ctr, frequency, conversions }],
                 // newest LAST
     rules: { rule_key: { active, params } },
     maxIncreasePct
   } */
export function evaluate({ adSet, series = [], rules = {}, maxIncreasePct = 20, now = new Date() } = {}) {
  // NEVER edit an ad set inside the learning phase. Returning a named reason
  // rather than an empty array so the caller can log why nothing happened.
  if (adSet?.learning_until && new Date(adSet.learning_until) > now) {
    return [{ rule_key: "learning_phase", action: "none",
              reason: `ad set is in the learning phase until ${adSet.learning_until}` }];
  }

  const proposals = [];
  const roasOk = roasAtOrAboveTarget(series, rules.roas_primary);

  for (const [key, fn] of Object.entries(RULES)) {
    const rule = rules[key];
    // An inactive rule does not run. That is how the two thresholds the spec said
    // not to invent stay off rather than running against a guessed number.
    if (!rule?.active) continue;

    const proposal = fn({ adSet, series, params: rule.params || {}, maxIncreasePct });
    if (!proposal) continue;

    // ROAS suppression: a throttling action is dropped while ROAS is healthy, but
    // a creative-queueing action still fires.
    if (roasOk && SUPPRESSED_WHILE_ROAS_OK.has(key) && isThrottle(proposal)) {
      proposals.push({
        rule_key: key, action: "none",
        reason: `${key} would have ${proposal.action} but ROAS is at or above target — ROAS is the primary trigger`
      });
      continue;
    }
    proposals.push({ rule_key: key, ...proposal });
  }
  return proposals;
}

const isThrottle = (p) => p.action === "pause" || p.action === "decrease_budget";

const SUPPRESSED_WHILE_ROAS_OK = new Set(["cpa_over_target", "ctr_below_floor"]);

/* roasAtOrAboveTarget — null target means "unknown", which must NOT be read as
   "ROAS is fine". An unset target suppresses nothing, so the secondary rules keep
   their teeth until somebody sets one. */
function roasAtOrAboveTarget(series, roasRule) {
  const target = roasRule?.params?.target_roas;
  if (target === null || target === undefined) return false;
  const latest = last(series);
  return latest?.roas !== null && latest?.roas !== undefined && Number(latest.roas) >= Number(target);
}

const RULES = {
  /* Scale a winner: ROAS above target for N consecutive days (default 3). */
  scale_winner({ adSet, series, params, maxIncreasePct }) {
    const need = Number(params.consecutive_days ?? 3);
    const target = params.target_roas ?? params.roas_target;
    if (target === null || target === undefined) return null;
    if (series.length < need) return null;

    // The LAST `need` days, all above target. A rule that counted any N days in the
    // window would scale a campaign that had three good days last week and has
    // been losing money since.
    const window = series.slice(-need);
    if (!window.every((d) => d.roas !== null && d.roas !== undefined && Number(d.roas) >= Number(target))) {
      return null;
    }

    const cap = Math.min(Number(maxIncreasePct), Number(params.hard_cap_pct ?? 30), 30);
    const from = Number(adSet.budget_cents);
    const to = Math.floor(from * (1 + cap / 100));
    if (to <= from) return null;

    return {
      action: "increase_budget",
      reason: `ROAS at or above ${target} for ${need} consecutive days`,
      from_budget_cents: from, to_budget_cents: to, increase_pct: cap,
      metrics: { roas_window: window.map((d) => d.roas) }
    };
  },

  /* CPA above target: cut 20%. The step back up is a separate concern handled by
     cpa_recovering below, so one rule does not both cut and raise. */
  cpa_over_target({ adSet, series, params }) {
    const target = params.target_cpa_cents;
    if (target === null || target === undefined) return null;
    const latest = last(series);
    if (!latest || latest.cpa_cents === null || latest.cpa_cents === undefined) return null;
    if (Number(latest.cpa_cents) <= Number(target)) return null;

    const cut = Number(params.cut_pct ?? 20);
    const from = Number(adSet.budget_cents);
    const to = Math.max(0, Math.floor(from * (1 - cut / 100)));
    return {
      action: "decrease_budget",
      reason: `CPA ${latest.cpa_cents} is above target ${target} — cutting ${cut}%`,
      from_budget_cents: from, to_budget_cents: to,
      metrics: { cpa_cents: latest.cpa_cents, target_cpa_cents: target }
    };
  },

  /* Frequency bands: <2 nothing, 2-3 queue creative, 3+ sustained refresh. */
  frequency_bands({ series, params }) {
    const latest = last(series);
    const f = latest?.frequency;
    if (f === null || f === undefined) return null;

    const noneBelow = Number(params.no_action_below ?? 2);
    const refreshAt = Number(params.refresh_at_or_above ?? 3);
    const sustained = Number(params.sustained_days ?? 2);

    if (Number(f) < noneBelow) return null;

    if (Number(f) >= refreshAt) {
      // "3+ SUSTAINED", not a single day's spike.
      const window = series.slice(-sustained);
      const held = window.length >= sustained &&
        window.every((d) => d.frequency !== null && Number(d.frequency) >= refreshAt);
      if (!held) {
        return { action: "queue_creative",
                 reason: `frequency ${f} is at or above ${refreshAt} but not yet sustained for ${sustained} days`,
                 metrics: { frequency: f } };
      }
      return { action: "refresh_creative",
               reason: `frequency has been at or above ${refreshAt} for ${sustained} consecutive days`,
               metrics: { frequency_window: window.map((d) => d.frequency) } };
    }

    return { action: "queue_creative",
             reason: `frequency ${f} is in the ${noneBelow}-${refreshAt} band — queue fresh creative`,
             metrics: { frequency: f } };
  },

  /* CTR under the floor: rotate creative every N hours until it clears. */
  ctr_below_floor({ adSet, series, params }) {
    const floor = Number(params.floor_pct ?? 2);
    const latest = last(series);
    if (!latest || latest.ctr === null || latest.ctr === undefined) return null;
    if (Number(latest.ctr) >= floor) return null;

    const everyHours = Number(params.rotate_every_hours ?? 72);
    // Respect the cadence: without this the rule fires on every daily run and
    // rotates creative once a day instead of once every 72 hours.
    if (adSet.rotated_at && hoursSince(adSet.rotated_at) < everyHours) return null;

    return {
      action: "rotate_creative",
      reason: `CTR ${latest.ctr}% is below the ${floor}% floor and the last rotation was over ${everyHours}h ago`,
      metrics: { ctr: latest.ctr, floor_pct: floor }
    };
  },

  /* Kill: no conversions after a spend floor.

     INACTIVE BY DEFAULT AND UNSEEDED. The spec said not to invent the floor, so
     the params carry null and the rule row ships inactive (048). Returning null on
     a null floor means that even if somebody activates the row without setting the
     number, nothing gets paused on a guess. */
  kill_no_conversions({ series, params }) {
    const floor = params.spend_floor_cents;
    if (floor === null || floor === undefined) return null;

    const spend = series.reduce((n, d) => n + Number(d.spend_cents || 0), 0);
    const conversions = series.reduce((n, d) => n + Number(d.conversions || 0), 0);
    if (spend < Number(floor) || conversions > 0) return null;

    return {
      action: "pause",
      reason: `spent ${spend} with zero conversions, past the ${floor} floor`,
      metrics: { spend_cents: spend, conversions: 0, floor_cents: Number(floor) }
    };
  }
};

/* stepBackUp — the recovery side of cpa_over_target: once CPA recovers, step the
   budget back up 10-20%/day. Separate from the cut so neither can accidentally
   trigger the other's side. */
export function stepBackUp({ adSet, series, params = {}, maxIncreasePct = 20 }) {
  const target = params.target_cpa_cents;
  if (target === null || target === undefined) return null;
  const latest = last(series);
  if (!latest || latest.cpa_cents === null || Number(latest.cpa_cents) > Number(target)) return null;

  const stepMin = Number(params.recovery_step_min_pct ?? 10);
  const stepMax = Number(params.recovery_step_max_pct ?? 20);
  // The lower bound of the band, capped by the partner's increase limit. The
  // conservative end is deliberate: recovering a cut campaign too fast re-triggers
  // the cut, and the oscillation costs more than the slower ramp.
  const pct = Math.min(stepMin, stepMax, Number(maxIncreasePct), 30);

  const from = Number(adSet.budget_cents);
  const to = Math.floor(from * (1 + pct / 100));
  if (to <= from) return null;
  return {
    rule_key: "cpa_recovering",
    action: "increase_budget",
    reason: `CPA ${latest.cpa_cents} has recovered below target ${target} — stepping back up ${pct}%`,
    from_budget_cents: from, to_budget_cents: to, increase_pct: pct,
    metrics: { cpa_cents: latest.cpa_cents }
  };
}

/* refreshCadenceFor — the spend-tier table. Returns null when the table is empty,
   which is how it ships (048): the spec said not to invent the tiers, so an unset
   table means the cadence rule does not tighten rather than tightening on a
   guessed threshold. */
export function refreshCadenceFor(dailySpendCents, tierParams = {}) {
  const tiers = Array.isArray(tierParams.tiers) ? tierParams.tiers : [];
  if (!tiers.length) return null;
  const applicable = tiers
    .filter((t) => Number(dailySpendCents) >= Number(t.daily_spend_cents_min ?? 0))
    .sort((a, b) => Number(b.daily_spend_cents_min ?? 0) - Number(a.daily_spend_cents_min ?? 0));
  return applicable[0]?.refresh_every_hours ?? null;
}

const last = (a) => (a.length ? a[a.length - 1] : null);
const hoursSince = (ts) => (Date.now() - new Date(ts).getTime()) / 36e5;

export { RULES };
export default evaluate;

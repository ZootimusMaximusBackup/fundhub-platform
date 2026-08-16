// Sales metrics for my-numbers (closer) and sales-floor (manager).
// Every number comes from call_outcomes, transactions, funding_closeout,
// shifts, or staff_targets. Missing sources become null + a reason — never fake.

import { BELIEFS, BELIEF_LABELS } from "./beliefs.mjs";
import { countUnlogged, listUnloggedCalls } from "./call-outcomes.mjs";
import { orgDemoModeEnabled, demoClause } from "../demo/exclude-demo.mjs";
import { listRecentRecordings } from "./recordings.mjs";

function monthWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

function priorWindow({ start, end }) {
  const ms = end.getTime() - start.getTime();
  return {
    start: new Date(start.getTime() - ms),
    end: start
  };
}

function rate(n, d) {
  if (!d) return null;
  return n / d;
}

function formatUsdFromCents(cents) {
  if (cents == null || !Number.isFinite(Number(cents))) return null;
  const n = Number(cents) / 100;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

async function staffCashCents(db, { orgId, staffId, start, end }) {
  const r = await db.query(
    `SELECT COALESCE(SUM(cash_collected_cents), 0)::bigint AS cents,
            count(*) FILTER (WHERE outcome = 'deposit')::int AS deposits,
            count(*) FILTER (WHERE outcome = 'downsell')::int AS downsells,
            count(*) FILTER (WHERE outcome = 'no_show')::int AS no_shows,
            count(*) FILTER (WHERE outcome <> 'no_show')::int AS held,
            count(*)::int AS logged
       FROM call_outcomes
      WHERE org_id = $1 AND staff_id = $2
        AND logged_at >= $3 AND logged_at < $4
        AND COALESCE(is_demo, false) = false`,
    [orgId, staffId, start.toISOString(), end.toISOString()]
  );
  return r.rows[0];
}

async function depositToFunded(db, { orgId, staffId = null, start, end }) {
  // Deposits this period whose client has funded=true OR a funding_closeout
  // via funding_rounds.
  const params = [orgId, start.toISOString(), end.toISOString()];
  let staffClause = "";
  if (staffId) {
    params.push(staffId);
    staffClause = `AND o.staff_id = $${params.length}`;
  }
  const r = await db.query(
    `SELECT count(*)::int AS deposits,
            count(*) FILTER (
              WHERE c.funded IS TRUE
                 OR EXISTS (
                      SELECT 1
                        FROM funding_rounds fr
                        JOIN funding_closeout fc ON fc.funding_round_id = fr.id
                       WHERE fr.client_id = o.client_id AND fr.org_id = o.org_id
                    )
            )::int AS funded
       FROM call_outcomes o
       JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
      WHERE o.org_id = $1
        AND o.outcome = 'deposit'
        AND o.logged_at >= $2 AND o.logged_at < $3
        ${staffClause}`,
    params
  );
  const deposits = Number(r.rows[0]?.deposits || 0);
  const funded = Number(r.rows[0]?.funded || 0);
  return { deposits, funded, rate: rate(funded, deposits) };
}

async function commissionBuckets(db, { orgId, staffId }) {
  // commission_ledger.amount is numeric dollars — convert to cents at the boundary.
  const r = await db.query(
    `SELECT
        COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) AS paid_dollars,
        COALESCE(SUM(amount) FILTER (WHERE status IN ('earned','approved')), 0) AS pending_dollars
       FROM commission_ledger
      WHERE org_id = $1 AND staff_id = $2
        AND COALESCE(is_demo, false) = false`,
    [orgId, staffId]
  ).catch(() => ({ rows: [{ paid_dollars: null, pending_dollars: null }] }));
  const row = r.rows[0] || {};
  if (row.paid_dollars == null && row.pending_dollars == null) {
    return {
      paid_cents: null,
      pending_cents: null,
      paid_reason: "commission_ledger not readable"
    };
  }
  return {
    paid_cents: Math.round(Number(row.paid_dollars || 0) * 100),
    pending_cents: Math.round(Number(row.pending_dollars || 0) * 100),
    paid_reason: null
  };
}

async function cashTargetCents(db, { orgId, staffId }) {
  const r = await db.query(
    `SELECT target_value FROM staff_targets
      WHERE org_id = $1 AND period = 'monthly' AND metric = 'deposits'
        AND (staff_id = $2 OR (staff_id IS NULL AND role = 'closer'))
      ORDER BY staff_id NULLS LAST
      LIMIT 1`,
    [orgId, staffId]
  );
  const v = r.rows[0]?.target_value;
  if (v == null) return { cents: null, reason: "No monthly deposits target in staff_targets" };
  // target_value for deposits is dollar amount of cash in existing Galaxy usage.
  return { cents: Math.round(Number(v) * 100), reason: null };
}

async function openShift(db, { orgId, staffId }) {
  const r = await db.query(
    `SELECT id, started_at FROM shifts
      WHERE org_id = $1 AND staff_id = $2 AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1`,
    [orgId, staffId]
  );
  return r.rows[0] || null;
}

/**
 * Closer personal metrics for my-numbers.html.
 * Always scoped to staffId — never org-wide for a closer session.
 */
export async function closerMyNumbers(db, { orgId, staffId, now = new Date() } = {}) {
  if (!orgId || !staffId) throw new TypeError("closerMyNumbers: orgId and staffId required");
  const window = monthWindow(now);
  const prior = priorWindow(window);

  const [cur, prev, d2f, commissions, target, shift, unlogged, unloggedList, team] = await Promise.all([
    staffCashCents(db, { orgId, staffId, ...window }),
    staffCashCents(db, { orgId, staffId, ...prior }),
    depositToFunded(db, { orgId, staffId, ...window }),
    commissionBuckets(db, { orgId, staffId }),
    cashTargetCents(db, { orgId, staffId }),
    openShift(db, { orgId, staffId }),
    countUnlogged(db, { orgId, staffId }),
    listUnloggedCalls(db, { orgId, staffId, limit: 10 }),
    teamLeaderboard(db, { orgId, ...window })
  ]);

  const cashCents = Number(cur.cents || 0);
  const held = Number(cur.held || 0);
  const deposits = Number(cur.deposits || 0);
  const closeRate = rate(deposits, held);
  const showDenom = held + Number(cur.no_shows || 0);
  const showRate = rate(held, showDenom);

  const meRank = team.findIndex((t) => t.staff_id === staffId);

  return {
    period: { start: window.start.toISOString(), end: window.end.toISOString(), label: "this month" },
    staff_id: staffId,
    shift: shift
      ? {
          on_shift: true,
          started_at: shift.started_at,
          elapsed_ms: Math.max(0, now.getTime() - new Date(shift.started_at).getTime())
        }
      : { on_shift: false, reason: "No open shift row" },
    pace: {
      cash_cents: cashCents,
      cash_display: formatUsdFromCents(cashCents),
      target_cents: target.cents,
      target_display: formatUsdFromCents(target.cents),
      target_reason: target.reason,
      rank: meRank >= 0 ? meRank + 1 : null,
      team_size: team.length
    },
    month: {
      deposits_closed: deposits,
      close_rate: closeRate,
      show_rate: showRate,
      downsells: Number(cur.downsells || 0),
      downsell_cash_cents: null, // would need separate sum; leave honest
      deposit_to_funded: d2f.rate,
      deposit_to_funded_n: d2f,
      avg_funded_cents: null,
      avg_funded_reason: "Average funded amount needs funding_rounds.funded_amount wired per closer — not scoped here yet",
      calls_held: held,
      no_shows: Number(cur.no_shows || 0),
      unlogged,
      prior: {
        deposits: Number(prev.deposits || 0),
        close_rate: rate(Number(prev.deposits || 0), Number(prev.held || 0))
      }
    },
    money: {
      paid_cents: commissions.paid_cents,
      pending_cents: commissions.pending_cents,
      at_risk_cents: null,
      at_risk_reason: "At-risk commission needs aging rules on open deposits — not built yet",
      paid_display: formatUsdFromCents(commissions.paid_cents),
      pending_display: formatUsdFromCents(commissions.pending_cents)
    },
    call_quality: {
      available: false,
      reason: "Call recording and transcription do not exist yet — talk ratio, monologue, and question counts cannot be measured"
    },
    compliance: {
      available: false,
      reason: "Compliance phrase detection needs call recordings — schema is ready (call_compliance_flags), pipeline is not"
    },
    team,
    owed: unloggedList.map((u) => ({
      urgency: "Now",
      title: `Log the call with ${u.client_name}`,
      detail: u.due_at
        ? `Held window ended ${u.due_at}; no outcome recorded`
        : "No outcome recorded",
      task_id: u.task_id,
      client_id: u.client_id
    })),
    streak: {
      available: false,
      reason: "Daily close streak needs a calendar of working days — not stored yet"
    }
  };
}

async function teamLeaderboard(db, { orgId, start, end }) {
  const r = await db.query(
    `SELECT o.staff_id,
            s.name,
            COALESCE(SUM(o.cash_collected_cents), 0)::bigint AS cash_cents,
            count(*) FILTER (WHERE o.outcome = 'deposit')::int AS deposits,
            count(*) FILTER (WHERE o.outcome <> 'no_show')::int AS held
       FROM call_outcomes o
       JOIN staff s ON s.id = o.staff_id AND s.org_id = o.org_id
      WHERE o.org_id = $1
        AND o.logged_at >= $2 AND o.logged_at < $3
        AND s.role = 'closer'
      GROUP BY o.staff_id, s.name
      ORDER BY cash_cents DESC, deposits DESC`,
    [orgId, start.toISOString(), end.toISOString()]
  );
  return r.rows.map((row, i) => {
    const held = Number(row.held || 0);
    const deposits = Number(row.deposits || 0);
    return {
      rank: i + 1,
      staff_id: row.staff_id,
      name: row.name,
      cash_cents: Number(row.cash_cents || 0),
      cash_display: formatUsdFromCents(row.cash_cents),
      deposits,
      close_rate: rate(deposits, held)
    };
  });
}

/**
 * Belief analytics: this period vs last period, cuttable by lead source + setter.
 */
export async function beliefAnalytics(db, { orgId, start, end } = {}) {
  const prior = priorWindow({ start, end });
  const r = await db.query(
    `SELECT o.belief_failed AS belief,
            COALESCE(cf.utm_campaign, cf.utm_source, c.channel_source, 'unknown') AS lead_source,
            COALESCE(cf.cf_setter_user_id, 'unknown') AS setter_key,
            count(*) FILTER (
              WHERE o.logged_at >= $2 AND o.logged_at < $3
            )::int AS this_count,
            count(*) FILTER (
              WHERE o.logged_at >= $4 AND o.logged_at < $5
            )::int AS last_count
       FROM call_outcomes o
       JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
       LEFT JOIN client_custom_fields cf ON cf.client_id = c.id AND cf.org_id = c.org_id
      WHERE o.org_id = $1
        AND o.belief_failed IS NOT NULL
        AND o.logged_at >= $4 AND o.logged_at < $3
      GROUP BY 1, 2, 3`,
    [orgId, start.toISOString(), end.toISOString(), prior.start.toISOString(), prior.end.toISOString()]
  );

  const byBelief = new Map(BELIEFS.map((b) => [b, { belief: b, label: BELIEF_LABELS[b], this_count: 0, last_count: 0 }]));
  const bySource = new Map();

  for (const row of r.rows) {
    const b = byBelief.get(row.belief);
    if (b) {
      b.this_count += Number(row.this_count || 0);
      b.last_count += Number(row.last_count || 0);
    }
    const key = `${row.lead_source}||${row.setter_key}`;
    if (!bySource.has(key)) {
      bySource.set(key, {
        lead_source: row.lead_source,
        setter_key: row.setter_key,
        held: 0,
        deposits: 0,
        desire: 0,
        beliefs: {}
      });
    }
    const s = bySource.get(key);
    s.beliefs[row.belief] = {
      this_count: Number(row.this_count || 0),
      last_count: Number(row.last_count || 0)
    };
    if (row.belief === "desire") s.desire += Number(row.this_count || 0);
  }

  // Held/close by source for the current period.
  const src = await db.query(
    `SELECT COALESCE(cf.utm_campaign, cf.utm_source, c.channel_source, 'unknown') AS lead_source,
            COALESCE(cf.cf_setter_user_id, 'unknown') AS setter_key,
            count(*) FILTER (WHERE o.outcome <> 'no_show')::int AS held,
            count(*) FILTER (WHERE o.outcome = 'deposit')::int AS deposits
       FROM call_outcomes o
       JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
       LEFT JOIN client_custom_fields cf ON cf.client_id = c.id AND cf.org_id = c.org_id
      WHERE o.org_id = $1
        AND o.logged_at >= $2 AND o.logged_at < $3
      GROUP BY 1, 2`,
    [orgId, start.toISOString(), end.toISOString()]
  );
  for (const row of src.rows) {
    const key = `${row.lead_source}||${row.setter_key}`;
    if (!bySource.has(key)) {
      bySource.set(key, {
        lead_source: row.lead_source,
        setter_key: row.setter_key,
        held: 0,
        deposits: 0,
        desire: 0,
        beliefs: {}
      });
    }
    const s = bySource.get(key);
    s.held = Number(row.held || 0);
    s.deposits = Number(row.deposits || 0);
    s.close_rate = rate(s.deposits, s.held);
  }

  const beliefs = [...byBelief.values()].sort((a, b) => b.this_count - a.this_count);
  const max = Math.max(1, ...beliefs.map((b) => b.this_count));
  for (const b of beliefs) b.bar = b.this_count / max;

  return {
    beliefs,
    sources: [...bySource.values()].sort((a, b) => (b.desire - a.desire) || (b.held - a.held)),
    period: { start: start.toISOString(), end: end.toISOString() },
    prior: { start: prior.start.toISOString(), end: prior.end.toISOString() }
  };
}

/**
 * Manager floor view.
 */
export async function salesFloor(db, { orgId, now = new Date(), env = process.env } = {}) {
  if (!orgId) throw new TypeError("salesFloor: orgId required");
  const window = monthWindow(now);

  const [cash, funnel, d2f, closers, beliefs, unlogged, cold, shiftsLate, recordings] = await Promise.all([
    db.query(
      `SELECT COALESCE(SUM(cash_collected_cents), 0)::bigint AS cents
         FROM call_outcomes
        WHERE org_id = $1 AND logged_at >= $2 AND logged_at < $3`,
      [orgId, window.start.toISOString(), window.end.toISOString()]
    ),
    floorFunnel(db, { orgId, ...window }),
    depositToFunded(db, { orgId, ...window }),
    closerRoster(db, { orgId, ...window, now }),
    beliefAnalytics(db, { orgId, ...window }),
    countUnlogged(db, { orgId }),
    coldDeals(db, { orgId }),
    lateShifts(db, { orgId, now }),
    listRecentRecordings(db, { orgId, now, env })
  ]);

  const cashCents = Number(cash.rows[0]?.cents || 0);
  const target = await db.query(
    `SELECT target_value FROM staff_targets
      WHERE org_id = $1 AND period = 'monthly' AND metric = 'deposits'
        AND staff_id IS NULL AND role = 'sales_manager'
      LIMIT 1`,
    [orgId]
  );
  const targetCents = target.rows[0]
    ? Math.round(Number(target.rows[0].target_value) * 100)
    : null;

  return {
    period: { start: window.start.toISOString(), end: window.end.toISOString() },
    hero: {
      cash_cents: cashCents,
      cash_display: formatUsdFromCents(cashCents),
      target_cents: targetCents,
      target_display: formatUsdFromCents(targetCents),
      target_reason: targetCents == null
        ? "No monthly sales_manager deposits target in staff_targets"
        : null,
      deposit_to_funded: d2f.rate,
      deposit_to_funded_n: d2f
    },
    funnel,
    closers,
    beliefs,
    recordings,
    compliance: {
      available: false,
      reason: recordings.items.length
        ? "Recordings are in Google Drive. Phrase flags still need transcription — table call_compliance_flags is ready."
        : (recordings.reason
          || "No Meet recordings yet. Click Record in Google Meet; the file lands in Drive."),
      items: []
    },
    cold_deals: cold,
    discipline: {
      unlogged_calls: unlogged,
      shifts_started_late: shiftsLate.count,
      shifts_detail: shiftsLate.detail,
      followups_overdue: null,
      followups_reason: "Follow-up overdue count needs a dedicated follow-up task type — not distinguished yet",
      avg_log_lag_days: null,
      avg_log_lag_reason: "Average time-to-log needs booking end timestamps joined to logged_at — booking end not on call_outcomes yet"
    }
  };
}

async function floorFunnel(db, { orgId, start, end }) {
  const [booked, outcomes] = await Promise.all([
    db.query(
      `SELECT count(DISTINCT client_id)::int AS n
         FROM events
        WHERE org_id = $1 AND name = 'booking.created'
          AND created_at >= $2 AND created_at < $3
          AND client_id IS NOT NULL`,
      [orgId, start.toISOString(), end.toISOString()]
    ),
    db.query(
      `SELECT count(*) FILTER (WHERE outcome <> 'no_show')::int AS held,
              count(*) FILTER (WHERE outcome = 'deposit')::int AS deposits,
              count(*) FILTER (WHERE outcome = 'downsell')::int AS downsells,
              COALESCE(SUM(cash_collected_cents) FILTER (WHERE outcome = 'downsell'), 0)::bigint AS downsell_cents
         FROM call_outcomes
        WHERE org_id = $1 AND logged_at >= $2 AND logged_at < $3`,
      [orgId, start.toISOString(), end.toISOString()]
    )
  ]);
  const bookedN = Number(booked.rows[0]?.n || 0);
  const held = Number(outcomes.rows[0]?.held || 0);
  const deposits = Number(outcomes.rows[0]?.deposits || 0);
  const d2f = await depositToFunded(db, { orgId, start, end });
  return {
    booked: bookedN,
    held,
    show_rate: rate(held, bookedN),
    deposits,
    close_rate: rate(deposits, held),
    funded: d2f.funded,
    funded_of_deposits: d2f.rate,
    downsells: Number(outcomes.rows[0]?.downsells || 0),
    downsell_cash_cents: Number(outcomes.rows[0]?.downsell_cents || 0),
    downsell_cash_display: formatUsdFromCents(outcomes.rows[0]?.downsell_cents)
  };
}

async function closerRoster(db, { orgId, start, end, now }) {
  const r = await db.query(
    `SELECT s.id AS staff_id, s.name,
            sh.started_at AS shift_started,
            COALESCE(agg.cash_cents, 0)::bigint AS cash_cents,
            COALESCE(agg.held, 0)::int AS held,
            COALESCE(agg.deposits, 0)::int AS deposits
       FROM staff s
       LEFT JOIN LATERAL (
         SELECT started_at FROM shifts
          WHERE org_id = s.org_id AND staff_id = s.id AND ended_at IS NULL
          ORDER BY started_at DESC LIMIT 1
       ) sh ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(cash_collected_cents), 0)::bigint AS cash_cents,
                count(*) FILTER (WHERE outcome <> 'no_show')::int AS held,
                count(*) FILTER (WHERE outcome = 'deposit')::int AS deposits
           FROM call_outcomes
          WHERE org_id = s.org_id AND staff_id = s.id
            AND logged_at >= $2 AND logged_at < $3
       ) agg ON true
      WHERE s.org_id = $1 AND s.role = 'closer' AND s.status = 'active'
      ORDER BY cash_cents DESC, s.name`,
    [orgId, start.toISOString(), end.toISOString()]
  );

  const out = [];
  for (const row of r.rows) {
    const d2f = await depositToFunded(db, {
      orgId, staffId: row.staff_id, start, end
    });
    const held = Number(row.held || 0);
    const deposits = Number(row.deposits || 0);
    const closeRate = rate(deposits, held);
    let action = "Keep working the board.";
    if (d2f.rate != null && d2f.rate < 0.7 && deposits >= 3) {
      action = "Chase docs. Sells more than funds.";
    } else if (closeRate != null && closeRate < 0.25 && held >= 10) {
      action = "Sit on the next call. Close rate is soft.";
    } else if (d2f.rate != null && d2f.rate >= 0.75) {
      action = "Leave them alone. Funded rate is strong.";
    }
    out.push({
      staff_id: row.staff_id,
      name: row.name,
      on_shift: !!row.shift_started,
      shift_started: row.shift_started,
      shift_elapsed_ms: row.shift_started
        ? Math.max(0, now.getTime() - new Date(row.shift_started).getTime())
        : null,
      calls: held,
      close_rate: closeRate,
      funded_rate: d2f.rate,
      cash_cents: Number(row.cash_cents || 0),
      cash_display: formatUsdFromCents(row.cash_cents),
      action
    });
  }
  return out;
}

async function coldDeals(db, { orgId }) {
  // Clients with a deposit outcome, not funded, no message in 7+ days.
  const r = await db.query(
    `SELECT c.id AS client_id,
            COALESCE(NULLIF(trim(c.first_name || ' ' || c.last_name), ''), c.email, 'Client') AS name,
            o.staff_id,
            s.name AS closer_name,
            o.logged_at AS deposit_at,
            EXTRACT(DAY FROM (now() - COALESCE(m.last_at, o.logged_at)))::int AS quiet_days
       FROM call_outcomes o
       JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
       JOIN staff s ON s.id = o.staff_id
       LEFT JOIN LATERAL (
         SELECT max(created_at) AS last_at FROM messages
          WHERE client_id = c.id AND org_id = c.org_id
       ) m ON true
      WHERE o.org_id = $1
        AND o.outcome = 'deposit'
        AND c.funded IS NOT TRUE
        AND o.logged_at < now() - interval '7 days'
        AND COALESCE(m.last_at, o.logged_at) < now() - interval '7 days'
      ORDER BY quiet_days DESC
      LIMIT 20`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  return r.rows.map((row) => ({
    client_id: row.client_id,
    name: row.name,
    closer_name: row.closer_name,
    quiet_days: Number(row.quiet_days || 0),
    detail: `${row.closer_name} · deposit paid, not funded`
  }));
}

async function lateShifts(db, { orgId, now }) {
  // Honest empty-ish: we can count shifts started after a local 9:30 if we assume UTC morning —
  // without a timezone on staff, report count of shifts started > 30m after scheduled? We don't have schedules.
  // Return honest empty.
  void orgId; void now;
  return {
    count: null,
    detail: [],
    reason: "Shift start lateness needs scheduled shift times — shifts table only has started_at/ended_at"
  };
}

export { formatUsdFromCents, monthWindow };

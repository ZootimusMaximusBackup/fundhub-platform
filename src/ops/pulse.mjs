// One numbers object for the Ops / AI COO daily pulse.
//
// Reuses computeKpis (company 8). Bars from staff_targets. Clocks from
// role-unit-times (MODEL). Calendar packed rule from hire-closer (MODEL).
// Does not write. Does not invent live averages or stopwatch times.

import { computeKpis } from "../dashboard/kpis.mjs";
import { ROLE_UNITS, CAPACITY } from "./role-unit-times.mjs";
import { loadCalendar, readLinkedInHireStatus, actOnPacked } from "./hire-closer.mjs";
import { CSUITE_SOURCE, monthKey, createCsuiteTask } from "./csuite-tasks.mjs";

const PERIODS = new Set(["today", "7d", "30d", "qtd"]);

function monthWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function companyEight(kpis) {
  if (!kpis) {
    return {
      new_clients: { value: null, missing: true },
      booked_calls: { value: null, missing: true },
      show_rate: { value: null, missing: true },
      close_rate: { value: null, missing: true },
      cash_cents: { value: null, missing: true },
      funded_count: { value: null, missing: true },
      funded_dollars_cents: { value: null, missing: true },
      cost_per_funded_cents: { value: null, missing: true, reason: "kpis_missing" }
    };
  }
  return {
    new_clients: { value: kpis.new_clients, missing: kpis.new_clients == null },
    booked_calls: { value: kpis.booked_count, missing: kpis.booked_count == null },
    show_rate: { value: kpis.show_rate, missing: kpis.show_rate == null },
    close_rate: { value: kpis.close_rate, missing: kpis.close_rate == null },
    cash_cents: { value: kpis.cash_collected_cents, missing: kpis.cash_collected_cents == null },
    funded_count: { value: kpis.funded_count, missing: kpis.funded_count == null },
    funded_dollars_cents: { value: kpis.funded_amount_cents, missing: kpis.funded_amount_cents == null },
    cost_per_funded_cents: {
      value: kpis.cost_per_funded_cents,
      missing: kpis.cost_per_funded_cents == null,
      reason: kpis.cost_per_funded_reason || null
    }
  };
}

async function loadBars(db, { orgId, now }) {
  const { start, end } = monthWindow(now);
  const targets = await db.query(
    `SELECT role, metric, target_value
       FROM staff_targets
      WHERE org_id = $1
        AND staff_id IS NULL
        AND period = 'monthly'
        AND (
          (role = 'closer' AND metric = 'deposits')
          OR (role = 'funding_advisor' AND metric = 'files')
        )`,
    [orgId]
  );

  const byRole = Object.fromEntries(
    (targets.rows || []).map((r) => [`${r.role}:${r.metric}`, numOrNull(r.target_value)])
  );

  let closerActual = null;
  let closerActualMissing = "deposits_not_read";
  try {
    const dep = await db.query(
      `SELECT count(*)::int AS n
         FROM call_outcomes
        WHERE org_id = $1
          AND outcome = 'deposit'
          AND logged_at >= $2 AND logged_at < $3
          AND COALESCE(is_demo, false) = false`,
      [orgId, start.toISOString(), end.toISOString()]
    );
    closerActual = Number(dep.rows[0]?.n || 0);
    closerActualMissing = null;
  } catch {
    closerActual = null;
    closerActualMissing = "deposits_not_available";
  }

  let fundedActual = null;
  let fundedActualMissing = "funded_files_not_read";
  try {
    const fund = await db.query(
      `SELECT count(*)::int AS n
         FROM clients
        WHERE org_id = $1
          AND funded IS TRUE
          AND updated_at >= $2 AND updated_at < $3`,
      [orgId, start.toISOString(), end.toISOString()]
    );
    fundedActual = Number(fund.rows[0]?.n || 0);
    fundedActualMissing = null;
  } catch {
    fundedActual = null;
    fundedActualMissing = "funded_files_not_available";
  }

  const closerTarget = byRole["closer:deposits"];
  const faTarget = byRole["funding_advisor:files"];

  return {
    closer: {
      role: "closer",
      metric: "deposits",
      period: "monthly",
      target: closerTarget,
      actual: closerActual,
      missing: closerTarget == null ? "closer_deposit_target_missing" : closerActualMissing
    },
    funding_advisor: {
      role: "funding_advisor",
      metric: "files",
      period: "monthly",
      target: faTarget,
      actual: fundedActual,
      missing: faTarget == null ? "funding_advisor_files_target_missing" : fundedActualMissing
    }
  };
}

/**
 * Which seats are short vs locked bars. Bookings have no monthly bar —
 * we only report the company-8 count. Never hire a setter.
 */
export function diagnoseGaps({ bars, calendar, company_8 } = {}) {
  const notes = [];
  const short = [];
  const missing = [];

  const closer = bars?.closer;
  if (!closer || closer.target == null) {
    missing.push({ seat: "closer", metric: "deposits", reason: closer?.missing || "target_missing" });
    notes.push("Closer deposit bar is missing.");
  } else if (closer.actual == null) {
    missing.push({ seat: "closer", metric: "deposits", reason: closer.missing || "actual_missing" });
    notes.push("Closer deposits this month are missing.");
  } else if (closer.actual < closer.target) {
    short.push({ seat: "closer", metric: "deposits", actual: closer.actual, target: closer.target });
    notes.push(`Closer deposits this month ${closer.actual} are under the starting bar of ${closer.target}.`);
  } else {
    notes.push(`Closer deposits this month ${closer.actual} meet the starting bar of ${closer.target}.`);
  }

  const fa = bars?.funding_advisor;
  if (!fa || fa.target == null) {
    missing.push({ seat: "funding_advisor", metric: "files", reason: fa?.missing || "target_missing" });
    notes.push("Funding advisor funded-files bar is missing.");
  } else if (fa.actual == null) {
    missing.push({ seat: "funding_advisor", metric: "files", reason: fa.missing || "actual_missing" });
    notes.push("Funding advisor funded files this month are missing.");
  } else if (fa.actual < fa.target) {
    short.push({ seat: "funding_advisor", metric: "files", actual: fa.actual, target: fa.target });
    notes.push(`Funding advisor funded files this month ${fa.actual} are under the starting bar of ${fa.target}.`);
  } else {
    notes.push(`Funding advisor funded files this month ${fa.actual} meet the starting bar of ${fa.target}.`);
  }

  const booked = company_8?.booked_calls;
  if (!booked || booked.missing || booked.value == null) {
    missing.push({ seat: "setter_ai", metric: "bookings", reason: "bookings_missing" });
    notes.push("Booked calls are missing. Setter is AI. Do not hire a setter.");
  } else {
    notes.push(`Booked calls this window: ${booked.value}. Setter is AI. Do not hire a setter.`);
  }

  if (calendar?.packed) {
    notes.push("Calendar is packed (MODEL). Need another closer. Do not hire a setter.");
    if (!short.some((s) => s.seat === "closer")) {
      short.push({
        seat: "closer",
        metric: "calendar",
        actual: calendar.due_at_count,
        target: calendar.threshold,
        reason: "packed"
      });
    }
  }

  return {
    short,
    missing,
    notes,
    has_short: short.length > 0
  };
}

export function hireProfileFromGaps({ gaps, calendar } = {}) {
  const closerNeed = calendar?.packed === true
    || (gaps?.short || []).some((s) => s.seat === "closer");
  const faNeed = (gaps?.short || []).some((s) => s.seat === "funding_advisor" && s.metric === "files");

  if (closerNeed) {
    return {
      seat: "closer",
      linkedin: true,
      lines: [
        "Seat: closer.",
        calendar?.packed
          ? "Why: the calendar is packed (MODEL count)."
          : "Why: deposits are under the starting bar this month.",
        "They talk to people who already booked. They present and log the deposit.",
        "Setter is AI. Do not hire a setter.",
        "Hired does not create a login. A person must invite."
      ]
    };
  }
  if (faNeed) {
    return {
      seat: "funding_advisor",
      linkedin: false,
      linkedin_reason: "closer LinkedIn path only — no second job-post provider",
      lines: [
        "Seat: funding advisor.",
        "Why: funded files are under the starting bar this month.",
        "They move files through funding rounds. Count files, not dollars.",
        "Do not hire a setter. Do not invent a second job-post path."
      ]
    };
  }
  return { seat: null, linkedin: false, lines: ["No hire profile this month."] };
}

export async function loadAdSpend(db, { orgId, days }) {
  const n = Number(days);
  const lookback = Number.isFinite(n) && n > 0 ? n : 7;
  try {
    const r = await db.query(
      `SELECT COALESCE(SUM(spend_cents), 0)::bigint AS cents
         FROM ad_metrics_daily
        WHERE org_id = $1
          AND date >= (CURRENT_DATE - ($2::int - 1))`,
      [orgId, lookback]
    );
    const cents = Number(r.rows[0]?.cents);
    if (!Number.isFinite(cents)) {
      return {
        status: "missing",
        spend_cents: null,
        source: "ad_metrics_daily",
        note: "Ad spend could not be read."
      };
    }
    return {
      status: "ok",
      spend_cents: cents,
      source: "ad_metrics_daily",
      note: "Read only. The brain does not buy, pause, or scale ads."
    };
  } catch {
    return {
      status: "not_configured",
      spend_cents: null,
      source: "ad_metrics_daily",
      note: "Ad spend could not be read."
    };
  }
}

async function existingHireTask(db, { now }) {
  const body = `hire-closer:packed:${monthKey(now)}`;
  const { rows } = await db.query(
    `SELECT id FROM tasks
      WHERE client_id IS NOT DISTINCT FROM $1
        AND source_workflow = $2
        AND body = $3
      LIMIT 1`,
    [null, CSUITE_SOURCE, body]
  );
  return rows[0] || null;
}

/**
 * computePulse(db, { orgId, period, now }) → pulse object.
 * Read only.
 */
export async function computePulse(db, { orgId, period = "7d", now = new Date() } = {}) {
  if (!orgId) throw new TypeError("computePulse: orgId required");
  const p = PERIODS.has(String(period)) ? String(period) : "7d";

  const kpis = await computeKpis(db, { orgId, period: p });
  const eight = companyEight(kpis);
  const [bars, calendar, linkedin, hireTask, ads] = await Promise.all([
    loadBars(db, { orgId, now }),
    loadCalendar(db, { orgId, now }),
    readLinkedInHireStatus(db, { orgId, now }),
    existingHireTask(db, { now }),
    loadAdSpend(db, { orgId, days: kpis.days })
  ]);

  const gaps = diagnoseGaps({ bars, calendar, company_8: eight });
  const profile = hireProfileFromGaps({ gaps, calendar });

  return {
    period: p,
    days: kpis.days,
    kpis,
    company_8: eight,
    bars,
    unit_clocks: {
      source: "MODEL",
      note: "Desk minutes are MODEL defaults (Grok-set 2026-08-24). Not live-timed.",
      units: ROLE_UNITS,
      capacity: CAPACITY
    },
    calendar,
    gaps,
    hire: {
      recommend: calendar.packed === true,
      existing_task_id: hireTask?.id || null,
      linkedin,
      profile
    },
    ads,
    fire: {
      auto_enqueue: false,
      rule_locked: false,
      note: "no fire rule yet"
    },
    raise: {
      auto_enqueue: false,
      rule_locked: false,
      note: "no raise rule yet"
    },
    bonus: {
      auto_enqueue: false,
      rule_locked: false,
      note: "no bonus rule yet"
    }
  };
}

/**
 * Write C-suite tasks from a fresh pulse. Hire + LinkedIn only when packed.
 * Diagnose when a seat is short. Ads review when spend is a real number > 0.
 * Never auto-enqueues fire, raise, or bonus. Never suspends. Never buys ads.
 */
export async function actOnBrain(db, {
  orgId,
  now = new Date(),
  ctx = {},
  createCsuiteTaskFn = createCsuiteTask,
  actOnPackedFn = actOnPacked,
  computePulseFn = computePulse
} = {}) {
  const pulse = await computePulseFn(db, { orgId, now });
  const hire = pulse.calendar.packed
    ? await actOnPackedFn(db, { orgId, now, ctx })
    : {
      acted: false,
      reason: "not_packed",
      calendar: pulse.calendar,
      task: null,
      linkedin: pulse.hire.linkedin
    };

  let diagnose = null;
  if (pulse.gaps.has_short) {
    diagnose = await createCsuiteTaskFn(db, {
      kind: "diagnose",
      orgId,
      now,
      title: "Look at team gaps",
      detail: pulse.gaps.notes.join(" ")
    });
  }

  let ads = null;
  if (pulse.ads.status === "ok" && pulse.ads.spend_cents > 0) {
    ads = await createCsuiteTaskFn(db, { kind: "ads_review", orgId, now });
  }

  return {
    acted: hire.acted === true || !!(diagnose && diagnose.created) || !!(ads && ads.created),
    reason: hire.acted ? null : (diagnose || ads ? "reviews_only" : hire.reason),
    calendar: hire.calendar || pulse.calendar,
    pulse,
    task: hire.task,
    linkedin: hire.linkedin,
    diagnose,
    ads_task: ads,
    fire: pulse.fire,
    raise: pulse.raise,
    bonus: pulse.bonus
  };
}

export default computePulse;

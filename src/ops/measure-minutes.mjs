// Join Hubstaff tracked_seconds + CRM event timestamps.
// Do not lock MODEL minutes from this. Lock only after a human says so.
// Same n floor as discoveries: 20 timed samples.

import { CLOSER_LOGGED_CALL_MINUTES } from "./role-unit-times.mjs";
import { MIN_N_TIME } from "./discoveries.mjs";

const FLOOR = MIN_N_TIME;

function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function actionRow({ id, label, minutes, n, note }) {
  const measured = n >= FLOOR && minutes != null;
  return {
    id,
    label,
    minutes: measured ? Math.round(minutes) : null,
    n: n || 0,
    source: measured ? "MEASURED" : "INSUFFICIENT",
    locked: false,
    note: measured
      ? `${note} MODEL is not overwritten.`
      : `Need ${FLOOR} samples. Have ${n || 0}. ${note} Minutes stay MODEL.`
  };
}

export function joinHubstaffAndCrm({ hubstaffSeconds = [], crmMinutes = [] } = {}) {
  const hsMin = hubstaffSeconds
    .map((s) => Number(s) / 60)
    .filter((n) => Number.isFinite(n) && n > 0);
  const crm = crmMinutes.filter((n) => Number.isFinite(n) && n > 0);
  return {
    hubstaff_median_minutes: median(hsMin),
    hubstaff_n: hsMin.length,
    crm_median_minutes: median(crm),
    crm_n: crm.length
  };
}

function emptyMeasured(note) {
  return {
    floor: FLOOR,
    locked: false,
    note: note || "Minutes are not locked. MODEL stays until a human locks after enough live samples.",
    join: {
      hubstaff_median_minutes: null,
      hubstaff_n: 0,
      crm_median_minutes: null,
      crm_n: 0
    },
    actions: []
  };
}

export async function measureMinutes(db, { orgId, days = 30 } = {}) {
  if (!orgId) throw new TypeError("measureMinutes: orgId required");
  const d = Number(days) > 0 ? Number(days) : 30;

  let hub, calls, books, rounds, wipes;
  try {
    [hub, calls, books, rounds, wipes] = await Promise.all([
      db.query(
        `SELECT (detail->>'tracked_seconds')::int AS seconds
           FROM staff_events
          WHERE org_id = $1
            AND kind = 'monitor_activity'
            AND detail->>'source' = 'hubstaff'
            AND created_at >= now() - ($2::int || ' days')::interval
            AND (detail->>'tracked_seconds') ~ '^[0-9]+$'`,
        [orgId, d]
      ).catch(() => ({ rows: [] })),
      db.query(
        `SELECT duration_seconds
           FROM call_outcomes
          WHERE org_id = $1
            AND duration_seconds IS NOT NULL
            AND duration_seconds > 0
            AND logged_at >= now() - ($2::int || ' days')::interval
            AND COALESCE(is_demo, false) = false`,
        [orgId, d]
      ).catch(() => ({ rows: [] })),
      db.query(
        `SELECT EXTRACT(EPOCH FROM (e.created_at - c.created_at)) / 60.0 AS minutes
           FROM events e
           JOIN clients c ON c.id = e.client_id
          WHERE e.org_id = $1
            AND e.name = 'booking.created'
            AND e.created_at >= now() - ($2::int || ' days')::interval
            AND e.client_id IS NOT NULL
            AND e.created_at > c.created_at`,
        [orgId, d]
      ).catch(() => ({ rows: [] })),
      db.query(
        `SELECT EXTRACT(EPOCH FROM (b.created_at - a.created_at)) / 60.0 AS minutes
           FROM events a
           JOIN events b
             ON b.client_id = a.client_id
            AND b.org_id = a.org_id
            AND b.name = 'round.submitted'
            AND b.created_at > a.created_at
          WHERE a.org_id = $1
            AND a.name = 'round.started'
            AND a.created_at >= now() - ($2::int || ' days')::interval`,
        [orgId, d]
      ).catch(() => ({ rows: [] })),
      db.query(
        `SELECT EXTRACT(EPOCH FROM (b.created_at - a.created_at)) / 60.0 AS minutes
           FROM events a
           JOIN events b
             ON b.client_id = a.client_id
            AND b.org_id = a.org_id
            AND b.name = 'inquiry.removed'
            AND b.created_at > a.created_at
          WHERE a.org_id = $1
            AND a.name IN ('inquiry.gate.raised', 'inquiry.docs.needed')
            AND a.created_at >= now() - ($2::int || ' days')::interval`,
        [orgId, d]
      ).catch(() => ({ rows: [] }))
    ]);
  } catch {
    return emptyMeasured("Query failed. Live tables may miss columns. MODEL minutes stay.");
  }

  const hs = (hub.rows || []).map((r) => Number(r.seconds));
  const callMin = (calls.rows || []).map((r) => Number(r.duration_seconds) / 60);
  const bookMin = (books.rows || []).map((r) => Number(r.minutes));
  const roundMin = (rounds.rows || []).map((r) => Number(r.minutes));
  const wipeMin = (wipes.rows || []).map((r) => Number(r.minutes));
  const joined = joinHubstaffAndCrm({ hubstaffSeconds: hs, crmMinutes: callMin });

  const actions = [
    actionRow({
      id: "closer_call",
      label: "Closer call",
      minutes: joined.crm_median_minutes ?? joined.hubstaff_median_minutes,
      n: Math.max(joined.crm_n, joined.hubstaff_n),
      note: `CRM durations ${joined.crm_n}. Hubstaff windows ${joined.hubstaff_n}. MODEL ${CLOSER_LOGGED_CALL_MINUTES} min.`
    }),
    actionRow({
      id: "setter_book",
      label: "Lead to booked call",
      minutes: median(bookMin),
      n: bookMin.filter((n) => Number.isFinite(n) && n > 0).length,
      note: "CRM: client created → booking.created."
    }),
    actionRow({
      id: "lender_round",
      label: "One funding round (start → submit)",
      minutes: median(roundMin),
      n: roundMin.filter((n) => Number.isFinite(n) && n > 0).length,
      note: "CRM: round.started → round.submitted. MODEL round is 50 desk minutes."
    }),
    actionRow({
      id: "inquiry_wipe",
      label: "Inquiry wipe",
      minutes: median(wipeMin),
      n: wipeMin.filter((n) => Number.isFinite(n) && n > 0).length,
      note: "CRM: inquiry gate/docs → inquiry.removed."
    })
  ];

  return {
    floor: FLOOR,
    locked: false,
    note: "Minutes are not locked. MODEL stays until a human locks after enough live samples.",
    join: joined,
    actions
  };
}

export default measureMinutes;

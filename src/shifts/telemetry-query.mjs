import { timesheet, hoursWorked } from "./timesheet.mjs";

const MONITOR_KINDS = ["monitor_activity", "monitor_screenshot"];

export async function listStaffShifts(db, { orgId, staffId, limit = 40 } = {}) {
  const res = await db.query(
    `SELECT id, org_id, staff_id, started_at, ended_at, closed_by, created_at
       FROM shifts
      WHERE staff_id = $1::uuid AND org_id = $2::uuid
      ORDER BY started_at DESC
      LIMIT $3::int`,
    [staffId, orgId, Math.min(Math.max(Number(limit) || 40, 1), 200)]
  );
  return (res && res.rows) || [];
}

export async function listStaffEvents(db, { orgId, staffId, kinds = null, limit = 100 } = {}) {
  const res = await db.query(
    `SELECT id, org_id, staff_id, shift_id, kind, detail, created_at
       FROM staff_events
      WHERE staff_id = $1::uuid AND org_id = $2::uuid
        AND ($3::text[] IS NULL OR kind = ANY($3::text[]))
      ORDER BY created_at DESC
      LIMIT $4::int`,
    [staffId, orgId, kinds && kinds.length ? kinds : null,
      Math.min(Math.max(Number(limit) || 100, 1), 500)]
  );
  return (res && res.rows) || [];
}

export function summarizeActivity(events) {
  const samples = (events || []).filter((e) => e.kind === "monitor_activity");
  const scores = samples.map((e) => {
    const n = Number((e.detail || {}).overall);
    return Number.isFinite(n) ? n : null;
  }).filter((n) => n !== null);
  const screenshotCount = (events || []).filter((e) => e.kind === "monitor_screenshot").length;
  let avg = null;
  if (scores.length) avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return {
    activity_samples: samples.length,
    avg_overall: avg,
    screenshot_samples: screenshotCount,
    recent: (events || []).slice(0, 20).map((e) => ({
      id: e.id, kind: e.kind, shift_id: e.shift_id, created_at: e.created_at, detail: e.detail
    }))
  };
}

export async function getStaffTelemetry(db, { orgId, staffId } = {}) {
  if (!staffId || !orgId) return { ok: false, reason: "missing_ids" };
  const staffRes = await db.query(
    `SELECT id, org_id, name, email, role, status,
            monitoring_consent_at, hubstaff_user_id, created_at
       FROM staff WHERE id = $1::uuid AND org_id = $2::uuid`,
    [staffId, orgId]
  );
  const staff = staffRes && staffRes.rows && staffRes.rows[0];
  if (!staff) return { ok: false, reason: "staff_not_found" };
  const shifts = await listStaffShifts(db, { orgId, staffId, limit: 40 });
  const sheet = timesheet(shifts);
  const events = await listStaffEvents(db, { orgId, staffId, kinds: MONITOR_KINDS, limit: 100 });
  return {
    ok: true,
    staff: {
      id: staff.id, name: staff.name, email: staff.email, role: staff.role, status: staff.status,
      monitoring_consent_at: staff.monitoring_consent_at,
      hubstaff_user_id: staff.hubstaff_user_id,
      monitoring_on: staff.monitoring_consent_at != null
    },
    shifts: shifts.map((s) => ({
      id: s.id, started_at: s.started_at, ended_at: s.ended_at,
      closed_by: s.closed_by, open: s.ended_at == null
    })),
    hours: {
      payable_hours: sheet.payableHours,
      hours_worked: hoursWorked(shifts),
      needs_review_count: (sheet.needsReview || []).length
    },
    activity: summarizeActivity(events)
  };
}

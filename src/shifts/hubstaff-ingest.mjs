// Merge Hubstaff activity into staff_events — Spec §14 deep monitoring.
// CONSENT GATE: monitoring_consent_at NULL ⇒ skip. No exceptions. No global override.

import {
  hubstaffConfigFromEnv,
  fetchActivities,
  fetchScreenshots
} from "../adapters/hubstaff.mjs";
import { logStaffEvent } from "./telemetry.mjs";

export const LOOKBACK_HOURS = 12;

export function hasMonitoringConsent(staffRow) {
  if (!staffRow) return false;
  const at = staffRow.monitoring_consent_at;
  return at !== null && at !== undefined && at !== "";
}

export async function loadConsentedMappedStaff(db, { orgId } = {}) {
  const res = await db.query(
    `SELECT id, org_id, hubstaff_user_id, monitoring_consent_at
       FROM staff
      WHERE monitoring_consent_at IS NOT NULL
        AND hubstaff_user_id IS NOT NULL
        AND ($1::uuid IS NULL OR org_id = $1::uuid)
      ORDER BY id`,
    [orgId ?? null]
  );
  return (res && res.rows) || [];
}

export async function loadRecentShifts(db, { staffIds, lookbackHours = LOOKBACK_HOURS } = {}) {
  if (!staffIds || !staffIds.length) return [];
  const res = await db.query(
    `SELECT id, org_id, staff_id, started_at, ended_at, closed_by
       FROM shifts
      WHERE staff_id = ANY($1::uuid[])
        AND (
          ended_at IS NULL
          OR ended_at >= now() - make_interval(hours => $2::int)
        )
      ORDER BY started_at`,
    [staffIds, lookbackHours]
  );
  return (res && res.rows) || [];
}

export function activityOverlapsShift(activityTime, shift, now = new Date()) {
  if (!activityTime || !shift || !shift.started_at) return false;
  const t = new Date(activityTime).getTime();
  if (!Number.isFinite(t)) return false;
  const start = new Date(shift.started_at).getTime();
  const end = shift.ended_at ? new Date(shift.ended_at).getTime() : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return t >= start && t <= end;
}

export function findOverlappingShift(activityTime, shifts, staffId, now = new Date()) {
  const mine = (shifts || []).filter((s) => String(s.staff_id) === String(staffId));
  for (const s of mine) {
    if (activityOverlapsShift(activityTime, s, now)) return s;
  }
  return null;
}

async function alreadyMerged(db, { staffId, kind, externalId }) {
  if (!externalId) return false;
  const res = await db.query(
    `SELECT 1 AS one
       FROM staff_events
      WHERE staff_id = $1::uuid
        AND kind = $2::text
        AND detail->>'external_id' = $3::text
      LIMIT 1`,
    [staffId, kind, externalId]
  );
  return !!(res && res.rows && res.rows[0]);
}

export async function mergeActivityEvent(db, { staff, shift, activity }) {
  if (!hasMonitoringConsent(staff)) return { logged: false, skipped: true, reason: "no_consent" };
  if (!staff.hubstaff_user_id) return { logged: false, skipped: true, reason: "no_hubstaff_mapping" };
  if (!activity || !activity.external_id) return { logged: false, skipped: true, reason: "invalid_activity" };
  if (!shift || !shift.id) return { logged: false, skipped: true, reason: "outside_shift" };
  if (await alreadyMerged(db, { staffId: staff.id, kind: "monitor_activity", externalId: activity.external_id })) {
    return { logged: false, skipped: true, reason: "duplicate" };
  }
  const detail = {
    source: "hubstaff",
    external_id: activity.external_id,
    hubstaff_user_id: String(staff.hubstaff_user_id),
    window_start: activity.window_start,
    window_end: activity.window_end,
    overall: activity.overall,
    keyboard: activity.keyboard,
    mouse: activity.mouse,
    tracked_seconds: activity.tracked_seconds,
    apps: activity.apps || [],
    urls: activity.urls || []
  };
  const result = await logStaffEvent(db, {
    orgId: staff.org_id, staffId: staff.id, shiftId: shift.id,
    kind: "monitor_activity", detail
  });
  return { ...result, skipped: !result.logged, reason: result.reason || null };
}

export async function mergeScreenshotEvent(db, { staff, shift, screenshot }) {
  if (!hasMonitoringConsent(staff)) return { logged: false, skipped: true, reason: "no_consent" };
  if (!staff.hubstaff_user_id) return { logged: false, skipped: true, reason: "no_hubstaff_mapping" };
  if (!screenshot || !screenshot.external_id) return { logged: false, skipped: true, reason: "invalid_screenshot" };
  if (!shift || !shift.id) return { logged: false, skipped: true, reason: "outside_shift" };
  if (await alreadyMerged(db, { staffId: staff.id, kind: "monitor_screenshot", externalId: screenshot.external_id })) {
    return { logged: false, skipped: true, reason: "duplicate" };
  }
  const detail = {
    source: "hubstaff",
    external_id: screenshot.external_id,
    hubstaff_user_id: String(staff.hubstaff_user_id),
    taken_at: screenshot.taken_at,
    thumb_url: screenshot.thumb_url
  };
  const result = await logStaffEvent(db, {
    orgId: staff.org_id, staffId: staff.id, shiftId: shift.id,
    kind: "monitor_screenshot", detail
  });
  return { ...result, skipped: !result.logged, reason: result.reason || null };
}

export async function pollAndMergeHubstaff(db, {
  env = process.env, orgId = null, lookbackHours = LOOKBACK_HOURS, fetchImpl, now = new Date()
} = {}) {
  const cfg = hubstaffConfigFromEnv(env);
  if (!cfg.ready) {
    return { ok: true, skipped: true, reason: "not_configured", missing: cfg.missing,
      merged: 0, skipped_no_consent: 0, skipped_outside_shift: 0, skipped_duplicate: 0 };
  }
  const staffRows = await loadConsentedMappedStaff(db, { orgId });
  const consented = staffRows.filter(hasMonitoringConsent);
  if (!consented.length) {
    return { ok: true, skipped: true, reason: "no_consented_mapped_staff",
      merged: 0, skipped_no_consent: 0, skipped_outside_shift: 0, skipped_duplicate: 0, candidates: 0 };
  }
  const byHubstaff = new Map();
  for (const s of consented) byHubstaff.set(String(s.hubstaff_user_id), s);
  const userIds = [...byHubstaff.keys()];
  const staffIds = consented.map((s) => s.id);
  const shifts = await loadRecentShifts(db, { staffIds, lookbackHours });
  const stopIso = now.toISOString();
  const startIso = new Date(now.getTime() - lookbackHours * 3600 * 1000).toISOString();
  const actRes = await fetchActivities(cfg, { startIso, stopIso, userIds, fetchImpl });
  const shotRes = await fetchScreenshots(cfg, { startIso, stopIso, userIds, fetchImpl });
  let merged = 0, skippedNoConsent = 0, skippedOutsideShift = 0, skippedDuplicate = 0;
  const fetchErrors = [];
  if (!actRes.ok) fetchErrors.push("activities:" + actRes.reason);
  if (!shotRes.ok) fetchErrors.push("screenshots:" + shotRes.reason);
  for (const activity of actRes.activities || []) {
    const staff = byHubstaff.get(String(activity.hubstaff_user_id));
    if (!staff) continue;
    if (!hasMonitoringConsent(staff)) { skippedNoConsent += 1; continue; }
    const when = activity.window_start || activity.window_end;
    const shift = findOverlappingShift(when, shifts, staff.id, now);
    const out = await mergeActivityEvent(db, { staff, shift, activity });
    if (out.logged) merged += 1;
    else if (out.reason === "no_consent") skippedNoConsent += 1;
    else if (out.reason === "outside_shift") skippedOutsideShift += 1;
    else if (out.reason === "duplicate") skippedDuplicate += 1;
  }
  for (const screenshot of shotRes.screenshots || []) {
    const staff = byHubstaff.get(String(screenshot.hubstaff_user_id));
    if (!staff) continue;
    if (!hasMonitoringConsent(staff)) { skippedNoConsent += 1; continue; }
    const when = screenshot.taken_at;
    const shift = findOverlappingShift(when, shifts, staff.id, now);
    const out = await mergeScreenshotEvent(db, { staff, shift, screenshot });
    if (out.logged) merged += 1;
    else if (out.reason === "no_consent") skippedNoConsent += 1;
    else if (out.reason === "outside_shift") skippedOutsideShift += 1;
    else if (out.reason === "duplicate") skippedDuplicate += 1;
  }
  return { ok: true, skipped: false, reason: null, merged, skipped_no_consent: skippedNoConsent,
    skipped_outside_shift: skippedOutsideShift, skipped_duplicate: skippedDuplicate,
    candidates: consented.length, fetch_errors: fetchErrors };
}

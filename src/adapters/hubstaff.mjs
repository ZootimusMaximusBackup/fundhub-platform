// Hubstaff deep-monitoring adapter — Spec §14 optional staff telemetry.
// Poll, not webhook. Fail-clean config. Normalize only — ingest owns consent + writes.

export const DEFAULT_API_BASE = "https://api.hubstaff.com";

export function hubstaffConfigFromEnv(env = process.env) {
  const baseUrl = String(env.HUBSTAFF_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
  const token = env.HUBSTAFF_TOKEN || env.HUBSTAFF_PAT || null;
  const organizationId = env.HUBSTAFF_ORG_ID || null;
  const missing = [];
  if (!token) missing.push("HUBSTAFF_TOKEN");
  if (!organizationId) missing.push("HUBSTAFF_ORG_ID");
  return { baseUrl, token, organizationId, ready: missing.length === 0, missing };
}

function authHeaders(cfg) {
  return { accept: "application/json", authorization: `Bearer ${cfg.token}` };
}

export async function hubstaffGet(cfg, pathName, query = {}, { fetchImpl = fetch } = {}) {
  if (!cfg || !cfg.ready) return { ok: false, status: 0, json: null, reason: "not_configured" };
  const url = new URL(cfg.baseUrl + pathName);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(`${k}[]`, String(item));
    else url.searchParams.set(k, String(v));
  }
  try {
    const res = await fetchImpl(url.toString(), { headers: authHeaders(cfg) });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok) return { ok: false, status: res.status, json, reason: `http_${res.status}` };
    return { ok: true, status: res.status, json };
  } catch (err) {
    return { ok: false, status: 0, json: null, reason: `network:${String((err && err.message) || err).slice(0, 120)}` };
  }
}

export async function fetchActivities(cfg, { startIso, stopIso, userIds, fetchImpl } = {}) {
  const pathName = `/v2/organizations/${encodeURIComponent(cfg.organizationId)}/activities`;
  const query = { "time_slot[start]": startIso, "time_slot[stop]": stopIso, page_limit: 500 };
  if (userIds && userIds.length) query.user_ids = userIds.map(String);
  const res = await hubstaffGet(cfg, pathName, query, { fetchImpl });
  if (!res.ok) return { ok: false, reason: res.reason, activities: [] };
  const raw = Array.isArray(res.json?.activities) ? res.json.activities
    : Array.isArray(res.json?.data) ? res.json.data : [];
  return { ok: true, activities: raw.map(normalizeActivity).filter(Boolean) };
}

export async function fetchScreenshots(cfg, { startIso, stopIso, userIds, fetchImpl } = {}) {
  const pathName = `/v2/organizations/${encodeURIComponent(cfg.organizationId)}/screenshots`;
  const query = { "time_slot[start]": startIso, "time_slot[stop]": stopIso, page_limit: 500 };
  if (userIds && userIds.length) query.user_ids = userIds.map(String);
  const res = await hubstaffGet(cfg, pathName, query, { fetchImpl });
  if (!res.ok) return { ok: false, reason: res.reason, screenshots: [] };
  const raw = Array.isArray(res.json?.screenshots) ? res.json.screenshots
    : Array.isArray(res.json?.data) ? res.json.data : [];
  return { ok: true, screenshots: raw.map(normalizeScreenshot).filter(Boolean) };
}

export function asPercent(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n >= 0 && n <= 1) return Math.round(n * 100);
  return Math.round(n);
}

function summarizeUsage(list, nameKey) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 8).map((item) => {
    if (!item || typeof item !== "object") return null;
    const name = item[nameKey] || item.name || item.title || item.site || null;
    const seconds = Number(item.tracked ?? item.seconds ?? item.time ?? 0);
    if (!name) return null;
    const key = nameKey === "url" ? "url" : "name";
    return { [key]: String(name), seconds: Number.isFinite(seconds) ? seconds : 0 };
  }).filter(Boolean);
}

export function normalizeActivity(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.id ?? raw.activity_id;
  if (id === undefined || id === null || id === "") return null;
  const userId = raw.user_id ?? raw.userId ?? (raw.user && raw.user.id);
  const startsAt = raw.starts_at || raw.start_time || raw.date || null;
  const tracked = raw.tracked ?? raw.tracked_seconds ?? raw.time ?? null;
  const trackedSeconds = tracked === null || tracked === undefined ? null : Number(tracked);
  return {
    source: "hubstaff",
    external_id: `activity:${id}`,
    hubstaff_user_id: userId == null ? null : String(userId),
    window_start: startsAt ? String(startsAt) : null,
    window_end: null,
    overall: asPercent(raw.overall ?? raw.activity ?? raw.activity_percentage),
    keyboard: asPercent(raw.keyboard ?? raw.keyboard_percentage),
    mouse: asPercent(raw.mouse ?? raw.mouse_percentage),
    tracked_seconds: Number.isFinite(trackedSeconds) ? trackedSeconds : null,
    apps: summarizeUsage(raw.applications || raw.apps || [], "name"),
    urls: summarizeUsage(raw.urls || raw.sites || [], "url")
  };
}

export function normalizeScreenshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.id ?? raw.screenshot_id;
  if (id === undefined || id === null || id === "") return null;
  const userId = raw.user_id ?? raw.userId ?? (raw.user && raw.user.id);
  const takenAt = raw.taken_at || raw.created_at || raw.time_slot || null;
  const thumb = raw.thumb_url || raw.thumbnail_url || raw.url || null;
  return {
    source: "hubstaff",
    external_id: `screenshot:${id}`,
    hubstaff_user_id: userId == null ? null : String(userId),
    taken_at: takenAt ? String(takenAt) : null,
    thumb_url: thumb ? String(thumb) : null
  };
}

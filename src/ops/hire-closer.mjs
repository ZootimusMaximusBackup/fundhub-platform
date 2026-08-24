// Packed-calendar hire rule + LinkedIn closer job post.
//
// MODEL / count-based. Not a live stopwatch.
//   slots_per_closer_day = floor(480 / 45) = 10
//   packed = closer-role tasks with due_at in the next 5 weekdays
//            >= closer_count * 10 * 5 * 0.9
//   closer_count === 0 and any closer slot in those 5 days → packed
//   no closer tasks with due_at in the window → packed is false
//
// Hire = C-suite task (sales_manager) + existing LinkedIn postJob.
// Does not invite, suspend, fire, or close a LinkedIn posting.

import {
  CLOSER_LOGGED_CALL_MINUTES,
  HOURS_PER_DAY
} from "./role-unit-times.mjs";
import { createCsuiteTask, monthKey } from "./csuite-tasks.mjs";
import { connectionFor, postJob } from "../hiring/linkedin.mjs";

export const PACKED_SOURCE = "MODEL";
export const WEEKDAY_WINDOW = 5;
export const FILL_FACTOR = 0.9;
export const HIRE_MARKER_PREFIX = "hire-closer:packed:";

export function slotsPerCloserDay(
  minutes = CLOSER_LOGGED_CALL_MINUTES,
  hours = HOURS_PER_DAY
) {
  const m = Number(minutes);
  const h = Number(hours);
  if (!Number.isFinite(m) || m <= 0) return null;
  if (!Number.isFinite(h) || h <= 0) return null;
  return Math.floor((h * 60) / m);
}

export function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Inclusive start, exclusive end, covering the next `n` weekdays (UTC). */
export function nextWeekdayRange(now = new Date(), n = WEEKDAY_WINDOW) {
  const start = startOfUtcDay(now);
  const cursor = new Date(start);
  let counted = 0;
  while (counted < n) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) counted += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { start, end: cursor };
}

export function packedFromCounts({ closerCount, dueAtCount }) {
  const slots = slotsPerCloserDay();
  const count = Number(closerCount);
  const due = Number(dueAtCount);
  if (!Number.isFinite(due) || due <= 0) {
    return {
      packed: false,
      reason: "no_closer_due_at",
      threshold: null,
      slots_per_closer_day: slots,
      source: PACKED_SOURCE
    };
  }
  if (!Number.isFinite(count) || count === 0) {
    return {
      packed: true,
      reason: "no_closers_with_slots",
      threshold: 0,
      slots_per_closer_day: slots,
      source: PACKED_SOURCE
    };
  }
  const threshold = count * slots * WEEKDAY_WINDOW * FILL_FACTOR;
  const packed = due >= threshold;
  return {
    packed,
    reason: packed ? "at_or_over_threshold" : "under_threshold",
    threshold,
    slots_per_closer_day: slots,
    source: PACKED_SOURCE
  };
}

export async function loadCalendar(db, { orgId, now = new Date() } = {}) {
  if (!orgId) throw new Error("loadCalendar: orgId is required");
  const window = nextWeekdayRange(now);
  const [closers, due] = await Promise.all([
    db.query(
      `SELECT count(*)::int AS n
         FROM staff
        WHERE org_id = $1
          AND role = 'closer'
          AND lower(coalesce(status, 'active')) = 'active'`,
      [orgId]
    ),
    db.query(
      `SELECT count(*)::int AS n
         FROM tasks
        WHERE org_id = $1
          AND assignee_role = 'closer'
          AND done = false
          AND due_at IS NOT NULL
          AND due_at >= $2
          AND due_at < $3`,
      [orgId, window.start.toISOString(), window.end.toISOString()]
    )
  ]);
  const closerCount = Number(closers.rows[0]?.n || 0);
  const dueAtCount = Number(due.rows[0]?.n || 0);
  const packed = packedFromCounts({ closerCount, dueAtCount });
  return {
    closer_count: closerCount,
    due_at_count: dueAtCount,
    window_weekdays: WEEKDAY_WINDOW,
    fill_factor: FILL_FACTOR,
    window_start: window.start.toISOString(),
    window_end: window.end.toISOString(),
    ...packed
  };
}

function applyUrl() {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || "https://fundhub.ai")
    .replace(/\/$/, "");
  return `${base}/app/hiring.html`;
}

function closerJobCopy(month) {
  const marker = `${HIRE_MARKER_PREFIX}${month}`;
  return {
    title: "Closer — Fundhub",
    location: "Remote — United States",
    apply_url: applyUrl(),
    description: [
      "Closer at Fundhub.",
      "",
      "You talk to people who already booked a call. You present the offer and log what happened.",
      "The setter seat is AI. We do not hire setters.",
      "",
      "This post opened because the closer calendar is packed. That packed rule is a MODEL count (45-minute close call, 8-hour day). It is not a live stopwatch.",
      "",
      "Marking hired does not create a login. A person must send an invite.",
      "",
      `Marker: ${marker}`
    ].join("\n")
  };
}

async function linkedinStatusFor(db, { orgId, month }) {
  const marker = `${HIRE_MARKER_PREFIX}${month}`;
  const { rows } = await db.query(
    `SELECT p.id, p.status, p.last_error, p.posted_at
       FROM hiring_job_postings p
       JOIN hiring_roles r ON r.id = p.role_id
      WHERE p.org_id = $1
        AND p.channel = 'linkedin'
        AND r.key = 'closer'
        AND p.description LIKE $2
      ORDER BY p.created_at DESC
      LIMIT 1`,
    [orgId, `%${marker}%`]
  );
  const row = rows[0];
  if (!row) return { status: "none", posting_id: null, last_error: null };
  return {
    status: row.status === "posted" ? "posted"
      : row.status === "failed" ? "failed"
        : row.status === "draft" ? "draft"
          : row.status,
    posting_id: row.id,
    last_error: row.last_error || null
  };
}

export async function readLinkedInHireStatus(db, { orgId, now = new Date() } = {}) {
  try {
    await connectionFor(db, { orgId });
  } catch {
    const existing = await linkedinStatusFor(db, { orgId, month: monthKey(now) }).catch(() => null);
    return {
      status: "not_configured",
      posting_id: existing?.posting_id || null,
      last_error: null,
      reused: "src/hiring/linkedin.mjs"
    };
  }
  const existing = await linkedinStatusFor(db, { orgId, month: monthKey(now) });
  return { ...existing, reused: "src/hiring/linkedin.mjs" };
}

async function ensureCloserPosting(db, { orgId, month }) {
  const existing = await linkedinStatusFor(db, { orgId, month });
  if (existing.posting_id) return existing;

  const role = (await db.query(
    `SELECT id FROM hiring_roles WHERE org_id = $1 AND key = 'closer' LIMIT 1`,
    [orgId]
  )).rows[0];
  if (!role) {
    return { status: "failed", posting_id: null, last_error: "no closer hiring role" };
  }

  const copy = closerJobCopy(month);
  const { rows } = await db.query(
    `INSERT INTO hiring_job_postings
       (org_id, role_id, channel, title, description, location, apply_url, status)
     VALUES ($1, $2, 'linkedin', $3, $4, $5, $6, 'draft')
     RETURNING id, status, last_error`,
    [orgId, role.id, copy.title, copy.description, copy.location, copy.apply_url]
  );
  const row = rows[0];
  return { status: "draft", posting_id: row.id, last_error: row.last_error || null };
}

export async function postCloserLinkedIn(db, {
  orgId,
  now = new Date(),
  ctx = {},
  postJobFn = postJob,
  connectionForFn = connectionFor
} = {}) {
  const month = monthKey(now);
  try {
    await connectionForFn(db, { orgId });
  } catch {
    return {
      status: "not_configured",
      posting_id: null,
      last_error: null,
      reused: "src/hiring/linkedin.mjs"
    };
  }

  const existing = await ensureCloserPosting(db, { orgId, month });
  if (existing.status === "posted") {
    return { ...existing, reused: "src/hiring/linkedin.mjs" };
  }
  if (!existing.posting_id) {
    return { ...existing, reused: "src/hiring/linkedin.mjs" };
  }

  const out = await postJobFn(db, { orgId, postingId: existing.posting_id, ctx });
  if (out?.ok) {
    return {
      status: "posted",
      posting_id: existing.posting_id,
      last_error: null,
      reused: "src/hiring/linkedin.mjs"
    };
  }
  return {
    status: "failed",
    posting_id: existing.posting_id,
    last_error: out?.error || "postJob failed",
    reused: "src/hiring/linkedin.mjs"
  };
}

/**
 * Create the hire task and post LinkedIn when packed.
 * Re-evaluates packed itself. Does not fire anyone. Does not auto-enqueue fire.
 */
export async function actOnPacked(db, {
  orgId,
  now = new Date(),
  ctx = {},
  createCsuiteTaskFn = createCsuiteTask,
  postCloserLinkedInFn = postCloserLinkedIn
} = {}) {
  const calendar = await loadCalendar(db, { orgId, now });
  if (!calendar.packed) {
    return {
      acted: false,
      reason: "not_packed",
      calendar,
      task: null,
      linkedin: await readLinkedInHireStatus(db, { orgId, now })
    };
  }

  const task = await createCsuiteTaskFn(db, { kind: "hire", orgId, now });
  const linkedin = await postCloserLinkedInFn(db, { orgId, now, ctx });
  return { acted: true, reason: null, calendar, task, linkedin };
}

export default { loadCalendar, actOnPacked, packedFromCounts, slotsPerCloserDay };

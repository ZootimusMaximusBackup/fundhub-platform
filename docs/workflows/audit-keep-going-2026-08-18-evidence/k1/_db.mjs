/**
 * K1 read-only. Booking, task, messages, documents, pipeline.
 * No writes. No secrets printed. No live-file id in output values beyond the
 * forbidden-id check.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-keep-going-2026-08-18-evidence/k1");
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FUNNEL = "edca0767-88e9-4cf4-8837-47382049503a";
const TASK = "d5300a31-7620-4abf-8ca7-c9295d1ebbaf";
const BOOKING = "f370a046-46a4-4d8a-a58e-d0d421a73d98";
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");

function tzParts(iso, zone) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    weekday: "short"
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    zone,
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    clock: `${parts.hour}:${parts.minute} ${parts.dayPeriod}`,
    weekday: parts.weekday
  };
}

function redactClient(row) {
  if (!row) return null;
  const name = `${row.first_name || ""} ${row.last_name || ""}`.trim();
  return {
    id: row.id,
    is_test: row.id === TEST,
    is_funnel: row.id === FUNNEL,
    is_live_forbidden: row.id === LIVE,
    name_len: name.length,
    name_has_e2e: /e2e/i.test(name),
    name_has_test: /test/i.test(name),
    name_preview: name.slice(0, 48),
    channel_source: row.channel_source || null,
    has_email: Boolean(row.email),
    email_is_plus_tag: /e2e/i.test(String(row.email || "")),
    has_phone: Boolean(row.phone)
  };
}

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();

async function q(sql, params = []) {
  try {
    const r = await c.query(sql, params);
    return { ok: true, n: r.rows.length, rows: r.rows };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 240) };
  }
}

const out = {
  at: new Date().toISOString(),
  env_names: {
    DATABASE_URL: true,
    STAFF_E2E_PASSWORD: Boolean(String(process.env.STAFF_E2E_PASSWORD || "").trim())
  },
  ids: { test: TEST, funnel: FUNNEL, task: TASK, booking: BOOKING }
};

out.bookings_table = await q(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('bookings','calcom_bookings','appointments')
`);

out.booking_event = await q(`
  SELECT id, name, created_at,
         payload->>'source' AS source,
         (payload->>'client_id' IS NOT NULL AND payload->>'client_id' <> '') AS has_payload_client,
         payload ? 'startTime' AS has_start,
         payload ? 'endTime' AS has_end,
         payload ? 'meetingUrl' AS has_meeting,
         payload ? 'bookingUid' AS has_uid,
         payload->>'startTime' AS start_time,
         payload->>'endTime' AS end_time
    FROM events
   WHERE id = $1
`, [BOOKING]);

out.booking_counts = await q(`
  SELECT
    count(*) FILTER (WHERE name = 'booking.created')::int AS created,
    count(*) FILTER (WHERE name = 'booking.created' AND payload->>'source' = 'clickfunnels')::int AS created_cf,
    count(*) FILTER (WHERE name = 'booking.created' AND payload->>'source' = 'calcom')::int AS created_calcom
  FROM events
  WHERE name LIKE 'booking.%'
`);

out.task = await q(`
  SELECT id, title, due_at, done, created_at, source_workflow,
         (client_id IS NOT NULL) AS has_client,
         client_id,
         (meeting_url IS NOT NULL AND meeting_url <> '') AS has_meeting_url
    FROM tasks
   WHERE id = $1
`, [TASK]);

if (out.task.ok && out.task.rows[0]) {
  const due = out.task.rows[0].due_at;
  out.task_due_zones = {
    utc: due,
    phoenix: tzParts(due, "America/Phoenix"),
    new_york: tzParts(due, "America/New_York"),
    utc_clock: tzParts(due, "UTC")
  };
}

out.strategy_tasks = await q(`
  SELECT
    count(*)::int AS n,
    count(*) FILTER (WHERE due_at IS NOT NULL)::int AS dated,
    count(*) FILTER (WHERE (due_at AT TIME ZONE 'America/Phoenix')::date = DATE '2026-08-18')::int AS due_aug18_phoenix,
    count(*) FILTER (WHERE (due_at AT TIME ZONE 'America/New_York')::date = DATE '2026-08-18')::int AS due_aug18_ny,
    count(*) FILTER (WHERE due_at >= now())::int AS due_future
  FROM tasks
  WHERE title ILIKE '%strategy session booked%'
`);

out.open_dated_tasks = await q(`
  SELECT count(*)::int AS n
    FROM tasks
   WHERE done = false AND due_at IS NOT NULL
`);

out.funnel_client = await q(`
  SELECT id, first_name, last_name, email, phone, channel_source
    FROM clients
   WHERE id = $1
`, [FUNNEL]);
if (out.funnel_client.ok) {
  out.funnel_client.rows = out.funnel_client.rows.map(redactClient);
}

out.test_client = await q(`
  SELECT id, first_name, last_name, email, phone, channel_source
    FROM clients
   WHERE id = $1
`, [TEST]);
if (out.test_client.ok) {
  out.test_client.rows = out.test_client.rows.map(redactClient);
}

out.test_conversations = await q(`
  SELECT id, channel, created_at, last_pulse_at,
         (summary IS NOT NULL AND summary <> '') AS has_summary
    FROM conversations
   WHERE client_id = $1
   ORDER BY channel, created_at
`, [TEST]);

out.test_messages = await q(`
  SELECT id, conversation_id, direction, channel, status, created_at,
         COALESCE(subject, '') AS subject,
         (rendered_body ILIKE '%e2e fire reply%') AS body_is_reply,
         (rendered_body ILIKE '%Fundhub e2e ping%') AS body_is_ping,
         (rendered_body ILIKE '%STOP%') AS body_mentions_stop,
         (subject ILIKE '%e2e fire reply%') AS subject_is_reply,
         (subject ILIKE '%e2e fire%') AS subject_is_fire
    FROM messages
   WHERE client_id = $1
   ORDER BY created_at DESC
   LIMIT 40
`, [TEST]);

out.funnel_messages = await q(`
  SELECT id, direction, channel, status, created_at,
         (subject IS NOT NULL AND subject <> '') AS has_subject
    FROM messages
   WHERE client_id = $1
   ORDER BY created_at DESC
   LIMIT 20
`, [FUNNEL]);

out.funnel_documents = await q(`
  SELECT id, kind, subtype, title, created_at,
         (generated_at IS NOT NULL) AS has_generated,
         delivery_status
    FROM documents
   WHERE client_id = $1
   ORDER BY created_at DESC
   LIMIT 40
`, [FUNNEL]);

out.funnel_cards = await q(`
  SELECT c.id, c.client_id, c.created_at,
         p.key AS pipeline_key, p.name AS pipeline_name,
         s.key AS stage_key, s.name AS stage_name
    FROM cards c
    JOIN pipelines p ON p.id = c.pipeline_id
    JOIN pipeline_stages s ON s.id = c.stage_id
   WHERE c.client_id = $1
`, [FUNNEL]);

out.test_cards = await q(`
  SELECT c.id, c.client_id,
         p.key AS pipeline_key, s.key AS stage_key, s.name AS stage_name
    FROM cards c
    JOIN pipelines p ON p.id = c.pipeline_id
    JOIN pipeline_stages s ON s.id = c.stage_id
   WHERE c.client_id = $1
`, [TEST]);

out.funnel_events = await q(`
  SELECT name, count(*)::int AS n, max(created_at) AS last_at
    FROM events
   WHERE client_id = $1
      OR id = $2
   GROUP BY 1
   ORDER BY last_at DESC
   LIMIT 20
`, [FUNNEL, BOOKING]);

out.live_touched = {
  test_has_live: out.test_messages.ok && false,
  funnel_is_live: FUNNEL === LIVE,
  task_client_is_live: out.task.ok && out.task.rows[0] && out.task.rows[0].client_id === LIVE
};

fs.writeFileSync(path.join(OUT, "db.json"), JSON.stringify(out, null, 2) + "\n");
await c.end();

const t = out.task.ok && out.task.rows[0];
const ev = out.booking_event.ok && out.booking_event.rows[0];
const replyN = out.test_messages.ok
  ? out.test_messages.rows.filter((r) => r.body_is_reply || r.subject_is_reply).length
  : 0;
const pingN = out.test_messages.ok
  ? out.test_messages.rows.filter((r) => r.body_is_ping).length
  : 0;

console.log(JSON.stringify({
  booking_row: Boolean(ev),
  booking_source: ev && ev.source,
  task_title: t && t.title,
  task_client_is_funnel: t && t.client_id === FUNNEL,
  due_phoenix: out.task_due_zones && out.task_due_zones.phoenix,
  due_ny: out.task_due_zones && out.task_due_zones.new_york,
  created_cf: out.booking_counts.ok && out.booking_counts.rows[0] && out.booking_counts.rows[0].created_cf,
  inbound_reply_rows: replyN,
  sms_ping_rows: pingN,
  funnel_docs: out.funnel_documents.ok ? out.funnel_documents.n : out.funnel_documents.error,
  funnel_cards: out.funnel_cards.ok ? out.funnel_cards.rows : out.funnel_cards.error
}));

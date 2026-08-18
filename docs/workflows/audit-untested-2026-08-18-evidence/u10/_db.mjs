/**
 * U10 read-only booking counts. No writes. No PII values.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u10");

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

async function q(sql, params = []) {
  try {
    const r = await c.query(sql, params);
    return { ok: true, n: r.rows.length, rows: r.rows };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 220) };
  }
}

const out = {
  at: new Date().toISOString(),
  env_names: {
    CALCOM_WEBHOOK_SECRET: !!String(process.env.CALCOM_WEBHOOK_SECRET || "").trim(),
    DATABASE_URL: true
  }
};

out.bookings_table = await q(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('bookings','calcom_bookings','appointments')
`);

out.booking_events = await q(`
  SELECT
    name,
    coalesce(payload->>'source','(none)') AS source,
    count(*)::int AS n,
    min(created_at) AS first_at,
    max(created_at) AS last_at
  FROM events
  WHERE name IN ('booking.created','booking.rescheduled','booking.cancelled','booking.noshow')
  GROUP BY 1, 2
  ORDER BY 1, 3 DESC
`);

out.booking_idem = await q(`
  SELECT
    count(*)::int AS n,
    count(*) FILTER (WHERE idempotency_key LIKE 'calcom:%')::int AS calcom_idem,
    count(*) FILTER (WHERE payload->>'source' = 'calcom')::int AS source_calcom,
    count(*) FILTER (WHERE payload->>'source' = 'clickfunnels')::int AS source_clickfunnels
  FROM events
  WHERE name IN ('booking.created','booking.rescheduled','booking.cancelled','booking.noshow')
`);

out.webhook_captures = await q(`
  SELECT provider, count(*)::int AS n, max(created_at) AS last_at
  FROM webhook_captures
  GROUP BY 1
  ORDER BY n DESC
`);

out.strategy_tasks = await q(`
  SELECT
    count(*)::int AS n,
    count(*) FILTER (WHERE due_at IS NOT NULL)::int AS dated,
    count(*) FILTER (WHERE due_at::date = CURRENT_DATE)::int AS due_today,
    count(*) FILTER (WHERE due_at >= now())::int AS due_future
  FROM tasks
  WHERE title ILIKE '%strategy session booked%'
`);

out.tasks_by_workflow = await q(`
  SELECT coalesce(source_workflow,'(null)') AS source_workflow, count(*)::int AS n
  FROM tasks
  GROUP BY 1
  ORDER BY n DESC
`);

fs.writeFileSync(path.join(OUT, "db.json"), JSON.stringify(out, null, 2));
await c.end();
console.log(JSON.stringify({
  bookings_table: out.bookings_table.rows,
  booking_events: out.booking_events.rows,
  booking_idem: out.booking_idem.rows,
  webhook_captures: out.webhook_captures.ok ? out.webhook_captures.rows : out.webhook_captures.error,
  strategy_tasks: out.strategy_tasks.rows,
  calcom_secret_present: out.env_names.CALCOM_WEBHOOK_SECRET
}));

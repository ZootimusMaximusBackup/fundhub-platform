// Read-only live DB counts for G5. No writes. No PII dumps.
import fs from "node:fs";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
for (const line of fs.readFileSync(ROOT + "/.env", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 1) continue;
  const k = t.slice(0, i).trim();
  const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

const inventory = JSON.parse(fs.readFileSync(new URL("./inventory.json", import.meta.url), "utf8"));
const listenEvents = inventory.listenEvents;

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();

async function q(sql, params = []) {
  const r = await c.query(sql, params);
  return r.rows;
}

const tables = await q(`
  SELECT table_schema, table_name
  FROM information_schema.tables
  WHERE table_schema IN ('public','marketing')
    AND (
      table_name ILIKE '%book%'
      OR table_name ILIKE '%cal%'
      OR table_name ILIKE '%appoint%'
      OR table_name IN ('events','tasks','call_outcomes','webhook_captures','failed_events','proxy_sessions','shifts')
    )
  ORDER BY 1, 2
`);

const eventCounts = await q(`
  SELECT name, count(*)::int AS n, min(created_at) AS first_at, max(created_at) AS last_at
  FROM events
  GROUP BY name
  ORDER BY n DESC
`);

const listenCounts = [];
for (const name of listenEvents) {
  const rows = await q(
    `SELECT count(*)::int AS n, min(created_at) AS first_at, max(created_at) AS last_at
     FROM events WHERE name = $1`,
    [name]
  );
  listenCounts.push({ name, n: rows[0].n, first_at: rows[0].first_at, last_at: rows[0].last_at });
}

const bookingSource = await q(`
  SELECT
    name,
    coalesce(payload->>'source','(none)') AS source,
    count(*)::int AS n
  FROM events
  WHERE name IN ('booking.created','booking.rescheduled','booking.cancelled','booking.noshow')
  GROUP BY 1, 2
  ORDER BY 1, 3 DESC
`);

const bookingIdem = await q(`
  SELECT
    count(*)::int AS n,
    count(*) FILTER (WHERE idempotency_key LIKE 'calcom:%')::int AS calcom_idem,
    count(*) FILTER (WHERE payload ? 'bookingUid')::int AS has_booking_uid
  FROM events
  WHERE name IN ('booking.created','booking.rescheduled','booking.cancelled','booking.noshow')
`);

const tasks = await q(`
  SELECT
    count(*)::int AS n,
    count(*) FILTER (WHERE due_at IS NOT NULL)::int AS with_due_at,
    count(*) FILTER (WHERE due_at IS NOT NULL AND done = false)::int AS open_dated,
    count(*) FILTER (WHERE due_at >= now())::int AS due_future
  FROM tasks
`);

const tasksByWorkflow = await q(`
  SELECT coalesce(source_workflow,'(null)') AS source_workflow, count(*)::int AS n,
         count(*) FILTER (WHERE due_at IS NOT NULL)::int AS dated
  FROM tasks
  GROUP BY 1
  ORDER BY n DESC
`);

const callOutcomes = await q(`
  SELECT
    count(*)::int AS n,
    count(*) FILTER (WHERE booking_ref IS NOT NULL)::int AS with_booking_ref
  FROM call_outcomes
`);

const webhookCaptures = await q(`
  SELECT provider, count(*)::int AS n, max(created_at) AS last_at
  FROM webhook_captures
  GROUP BY 1
  ORDER BY n DESC
`);

const failedEvents = await q(`
  SELECT event_name, count(*)::int AS n
  FROM failed_events
  GROUP BY 1
  ORDER BY n DESC
  LIMIT 40
`).catch(async () => {
  const cols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='failed_events' ORDER BY ordinal_position
  `);
  return { column_probe: cols };
});

const proxy = await q(`
  SELECT
    count(*)::int AS n,
    count(*) FILTER (WHERE client_id = '8556bedc-46e1-4d85-b0cd-a24adfee1521')::int AS test_client,
    max(created_at) AS last_at
  FROM proxy_sessions
`);

const proxyByStatus = await q(`
  SELECT status, coalesce(error_code,'(null)') AS error_code, count(*)::int AS n
  FROM proxy_sessions
  GROUP BY 1, 2
  ORDER BY n DESC
`);

const neverSeen = inventory.functions.map((fn) => {
  if (fn.cron && !fn.listenEvents.length) {
    return { id: fn.id, trigger: "cron", eventCounts: [], neverSeenEvent: null };
  }
  const counts = fn.listenEvents.map((name) => {
    const row = listenCounts.find((r) => r.name === name);
    return { name, n: row ? row.n : 0 };
  });
  return {
    id: fn.id,
    registered: fn.registeredInIndex,
    eventCounts: counts,
    neverSeenEvent: counts.length > 0 && counts.every((c) => c.n === 0)
  };
});

const out = {
  at: new Date().toISOString(),
  tables,
  eventCounts,
  listenCounts,
  neverSeenFunctions: neverSeen.filter((x) => x.neverSeenEvent).map((x) => x.id),
  neverSeen,
  bookingSource,
  bookingIdem: bookingIdem[0],
  tasks: tasks[0],
  tasksByWorkflow,
  callOutcomes: callOutcomes[0],
  webhookCaptures,
  failedEvents,
  proxy: proxy[0],
  proxyByStatus
};

fs.writeFileSync(new URL("./db.json", import.meta.url), JSON.stringify(out, null, 2));
await c.end();
console.log(JSON.stringify({
  tables: tables.map((t) => t.table_name),
  listenCounts,
  neverSeenFunctions: out.neverSeenFunctions,
  bookingIdem: out.bookingIdem,
  tasks: out.tasks,
  proxy: out.proxy
}, null, 2));

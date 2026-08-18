// Follow-up read-only counts: booking dates, idempotency prefixes, live workflow registry.
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

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();

const taskDays = await c.query(`
  SELECT (due_at AT TIME ZONE 'America/New_York')::date AS day,
         count(*)::int AS n,
         count(*) FILTER (WHERE done = false)::int AS open
  FROM tasks
  WHERE source_workflow = 'calcom' AND due_at IS NOT NULL
  GROUP BY 1
  ORDER BY 1
`);

const taskTitles = await c.query(`
  SELECT title, count(*)::int AS n
  FROM tasks
  WHERE source_workflow = 'calcom'
  GROUP BY 1
  ORDER BY n DESC
`);

const idemPrefixes = await c.query(`
  SELECT
    split_part(coalesce(idempotency_key,''), ':', 1) AS prefix,
    count(*)::int AS n
  FROM events
  WHERE name LIKE 'booking.%'
  GROUP BY 1
  ORDER BY n DESC
`);

const bookingUidPrefixes = await c.query(`
  SELECT
    CASE
      WHEN payload->>'bookingUid' LIKE 'seed_bk_%' THEN 'seed_bk_'
      WHEN payload->>'bookingUid' LIKE 'demo%' THEN 'demo'
      WHEN payload->>'bookingUid' ~ '^[0-9]+$' THEN 'numeric'
      WHEN length(payload->>'bookingUid') >= 8 THEN left(payload->>'bookingUid', 8) || '…'
      ELSE coalesce(payload->>'bookingUid','(none)')
    END AS uid_shape,
    payload->>'source' AS source,
    count(*)::int AS n
  FROM events
  WHERE name LIKE 'booking.%'
  GROUP BY 1, 2
  ORDER BY n DESC
`);

const partnerBook = await c.query(`
  SELECT count(*)::int AS n FROM v_partner_book
`).catch((err) => ({ rows: [{ error: String(err.message).slice(0, 160) }] }));

await c.end();

const password = process.env.STAFF_E2E_PASSWORD;
const login = await fetch("https://fundhub.ai/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "chris@fundhub.ai", password })
});
const loginBody = await login.json();
const token = loginBody.token;
const wf1 = await fetch("https://fundhub.ai/api/read/workflows?limit=100&offset=0", {
  headers: { authorization: "Bearer " + token, accept: "application/json" }
});
const wfBody = await wf1.json();
const items = wfBody.items || [];
const workflows = items.map((r) => ({
  id: r.id,
  engine_active: r.engine_active,
  status: r.status,
  events: r.events,
  crons: r.crons,
  last_triggered_at: r.last_triggered_at
}));

const out = {
  at: new Date().toISOString(),
  taskDays: taskDays.rows,
  taskTitles: taskTitles.rows,
  idemPrefixes: idemPrefixes.rows,
  bookingUidShapes: bookingUidPrefixes.rows,
  partnerBook: partnerBook.rows,
  workflows: {
    count: wfBody.count,
    limit: wfBody.limit,
    hasMore: wfBody.hasMore,
    engine_active_values: [...new Set(workflows.map((w) => w.engine_active))],
    status_counts: workflows.reduce((acc, w) => {
      acc[w.status] = (acc[w.status] || 0) + 1;
      return acc;
    }, {}),
    sweeper: workflows.find((w) => w.id === "message-dispatch-sweeper") || null,
    contractChaser: workflows.find((w) => w.id === "contract-chaser") || null,
    ids: workflows.map((w) => w.id)
  }
};

fs.writeFileSync(new URL("./follow.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  taskDays: out.taskDays,
  taskTitles: out.taskTitles,
  idemPrefixes: out.idemPrefixes,
  bookingUidShapes: out.bookingUidShapes,
  partnerBook: out.partnerBook,
  workflows: {
    count: out.workflows.count,
    hasMore: out.workflows.hasMore,
    engine_active_values: out.workflows.engine_active_values,
    status_counts: out.workflows.status_counts,
    sweeper: out.workflows.sweeper,
    nIds: out.workflows.ids.length
  }
}, null, 2));

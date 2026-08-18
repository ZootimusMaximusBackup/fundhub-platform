// Remaining F-MAIL dumps. No sends. No live-file writes.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-fire-2026-08-18-evidence/f-mail");
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
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

function dump(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2) + "\n");
}

loadDotEnv();
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();

const events = await c.query(
  `SELECT name, count(*)::int AS n, max(created_at) AS last_at
     FROM events
    WHERE client_id = $1::uuid
      AND name IN ('message.inbound', 'mail.response')
      AND created_at > now() - interval '30 minutes'
    GROUP BY name
    ORDER BY name`,
  [TEST]
);

const recentEvents = await c.query(
  `SELECT name, created_at,
          (payload->>'from' IS NOT NULL) AS has_from,
          (payload->>'body' ILIKE '%e2e fire reply%') AS body_is_reply,
          (upper(trim(payload->>'body')) = 'STOP') AS body_is_stop
     FROM events
    WHERE client_id = $1::uuid
      AND name IN ('message.inbound', 'mail.response')
      AND created_at > now() - interval '30 minutes'
    ORDER BY created_at DESC
    LIMIT 8`,
  [TEST]
);

const inboundMsgs = await c.query(
  `SELECT id, direction, channel, status, subject,
          (rendered_body ILIKE '%e2e fire reply%') AS body_is_reply,
          (upper(trim(rendered_body)) = 'STOP') AS body_is_stop,
          created_at
     FROM messages
    WHERE client_id = $1::uuid
      AND direction = 'inbound'
      AND created_at > now() - interval '30 minutes'
    ORDER BY created_at DESC`,
  [TEST]
);

const optOuts = await c.query(
  `SELECT channel, source, (opted_in_at IS NULL) AS currently_out, opted_out_at, opted_in_at
     FROM opt_outs
    WHERE client_id = $1::uuid
    ORDER BY channel`,
  [TEST]
);

const liveOpt = await c.query(
  `SELECT count(*)::int AS n FROM opt_outs WHERE client_id = $1::uuid`,
  [LIVE]
);

const convos = await c.query(
  `SELECT id, channel, updated_at
     FROM conversations
    WHERE client_id = $1::uuid
    ORDER BY updated_at DESC
    LIMIT 5`,
  [TEST]
);

const liveGuard = await c.query(
  `SELECT
     (SELECT count(*)::int FROM events WHERE client_id = $1::uuid AND created_at > now() - interval '30 minutes') AS live_new_events,
     (SELECT count(*)::int FROM messages WHERE client_id = $1::uuid AND created_at > now() - interval '30 minutes') AS live_new_messages,
     (SELECT count(*)::int FROM opt_outs WHERE client_id = $1::uuid) AS live_opt_outs`,
  [LIVE]
);

dump("10-events.json", { test_client: events.rows, recent: recentEvents.rows });
dump("11-inbound-messages.json", inboundMsgs.rows);
dump("12-opt-outs.json", {
  test_rows: optOuts.rows,
  live_opt_out_count: liveOpt.rows[0].n,
  email_currently_out: optOuts.rows.some((r) => r.channel === "email" && r.currently_out)
});
dump("13-conversations.json", {
  n: convos.rows.length,
  channels: convos.rows.map((r) => r.channel)
});
dump("14-live-guard.json", liveGuard.rows[0]);

await c.end();
console.log(JSON.stringify({
  inbound_events: events.rows,
  inbound_message_rows: inboundMsgs.rows.length,
  reply_row: inboundMsgs.rows.some((r) => r.body_is_reply),
  stop_row: inboundMsgs.rows.some((r) => r.body_is_stop),
  email_opted_out: optOuts.rows.some((r) => r.channel === "email" && r.currently_out),
  live_new_events: liveGuard.rows[0].live_new_events,
  live_new_messages: liveGuard.rows[0].live_new_messages
}));

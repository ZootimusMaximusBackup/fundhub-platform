/** W13 follow-up counts. No PII bodies. */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w13");

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

function keyPresent(name) {
  return !!(process.env[name] && String(process.env[name]).trim());
}

async function q(c, sql, params = []) {
  try {
    const r = await c.query(sql, params);
    return { ok: true, rows: r.rows, n: r.rowCount };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 400) };
  }
}

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();
const out = { at: new Date().toISOString() };

out.twilio_key_names = {
  TWILIO_ACCOUNT_SID: keyPresent("TWILIO_ACCOUNT_SID"),
  TWILIO_AUTH_TOKEN: keyPresent("TWILIO_AUTH_TOKEN"),
  TWILIO_TOKEN: keyPresent("TWILIO_TOKEN"),
  TWILIO_API_KEY: keyPresent("TWILIO_API_KEY"),
  TWILIO_API_SECRET: keyPresent("TWILIO_API_SECRET"),
  TWILIO_FROM_NUMBER: keyPresent("TWILIO_FROM_NUMBER"),
  TWILIO_MESSAGING_SERVICE_SID: keyPresent("TWILIO_MESSAGING_SERVICE_SID")
};

out.status_counts = await q(c, `
  SELECT status, count(*)::int AS n FROM agents GROUP BY 1 ORDER BY 1
`);

out.ag01_guardrails = await q(c, `
  SELECT code, guardrails, updated_at FROM agents WHERE code = 'AG-01'
`);

out.inquiry_cases = await q(c, `
  SELECT
    count(*)::int AS n,
    count(*) FILTER (WHERE call_fired_at IS NOT NULL)::int AS call_fired,
    count(*) FILTER (WHERE ai_call_scheduled_for IS NOT NULL)::int AS scheduled,
    count(*) FILTER (WHERE ai_call_status IS NOT NULL AND btrim(ai_call_status) <> '')::int AS has_ai_call_status,
    count(*) FILTER (WHERE voice_provider IS NOT NULL AND btrim(voice_provider) <> '')::int AS has_voice_provider
  FROM inquiry_removal_cases
`);

out.inquiry_ai_call_status = await q(c, `
  SELECT coalesce(ai_call_status,'(null)') AS ai_call_status,
         coalesce(voice_provider,'(null)') AS voice_provider,
         count(*)::int AS n
    FROM inquiry_removal_cases
   GROUP BY 1, 2
   ORDER BY 3 DESC
`);

out.event_counts = await q(c, `
  SELECT name, count(*)::int AS n
    FROM events
   WHERE name IN (
     'message.inbound','message.outbound','call.completed','call.started',
     'inquiry.removed','deposit.paid'
   )
   GROUP BY 1
`);

out.message_inbound_exists = await q(c, `
  SELECT count(*)::int AS n FROM events WHERE name = 'message.inbound'
`);

out.call_completed = await q(c, `
  SELECT id, name, created_at,
         payload ? 'source' AS has_source,
         payload->>'source' AS source,
         payload->>'callId' AS call_id,
         payload->>'status' AS status,
         payload->>'disposition' AS disposition,
         payload->>'outcome' AS outcome,
         (payload->>'durationSec') AS duration_sec,
         client_id IS NOT NULL AS has_client_id
    FROM events
   WHERE name = 'call.completed'
   ORDER BY created_at DESC
   LIMIT 5
`);

out.messages_direction = await q(c, `
  SELECT direction, channel, sender_kind, count(*)::int AS n
    FROM messages
   GROUP BY 1, 2, 3
   ORDER BY 4 DESC
   LIMIT 30
`);

await c.end();
fs.writeFileSync(path.join(OUT, "follow.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  wrote: "follow.json",
  status_counts: out.status_counts.rows,
  inquiry: out.inquiry_cases.rows,
  inbound_events: out.message_inbound_exists.rows,
  call_completed: out.call_completed.rows,
  twilio: out.twilio_key_names
}, null, 2));

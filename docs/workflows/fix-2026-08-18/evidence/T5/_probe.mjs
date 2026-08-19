/**
 * T5 read-only evidence probe. SELECT only. Never prints a secret, an email,
 * a phone number or a person's name — counts, booleans and ids only.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/tmp/wt-T5";
const OUT = process.argv[2] || path.join(ROOT, "docs/workflows/fix-2026-08-18/evidence/T5/before");
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";

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
fs.mkdirSync(OUT, { recursive: true });

const inbox = String(process.env.FUNDHUB_TEST_INBOX || "").trim();
const phone = String(process.env.FUNDHUB_TEST_PHONE || "").trim();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
async function q(sql, params = []) {
  try { const r = await c.query(sql, params); return { ok: true, n: r.rowCount, rows: r.rows }; }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 240) }; }
}

const out = { at: new Date().toISOString(), note: "read-only; no values printed",
  env_set: { FUNDHUB_TEST_INBOX: !!inbox, FUNDHUB_TEST_PHONE: !!phone,
             RESEND_WEBHOOK_SECRET: !!process.env.RESEND_WEBHOOK_SECRET,
             MAILGUN_SIGNING_KEY: !!process.env.MAILGUN_SIGNING_KEY,
             UNSUBSCRIBE_TOKEN_SECRET: !!process.env.UNSUBSCRIBE_TOKEN_SECRET,
             TWILIO_AUTH_TOKEN: !!process.env.TWILIO_AUTH_TOKEN,
             APP_BASE_URL: !!process.env.APP_BASE_URL, URL: !!process.env.URL } };

// T5-01/02/03 — opt_outs
out.opt_outs_total = await q(`SELECT count(*)::int AS n FROM opt_outs`);
out.opt_outs_by = await q(`SELECT channel, source, count(*)::int AS n FROM opt_outs GROUP BY 1,2 ORDER BY 1,2`);
out.opt_outs_cols = await q(
  `SELECT column_name, data_type, is_nullable FROM information_schema.columns
   WHERE table_name='opt_outs' ORDER BY ordinal_position`);

// T5-11 — lorem templates
out.templates_total = await q(`SELECT count(*)::int AS n FROM message_templates`);
out.templates_lorem = await q(
  `SELECT split_part(key,'-',1)||'-'||split_part(key,'-',2) AS family, count(*)::int AS n
   FROM message_templates WHERE body ILIKE '%lorem ipsum%' OR COALESCE(subject,'') ILIKE '%lorem ipsum%'
   GROUP BY 1 ORDER BY 2 DESC`);
out.templates_lorem_keys = await q(
  `SELECT key, channel FROM message_templates
   WHERE body ILIKE '%lorem ipsum%' OR COALESCE(subject,'') ILIKE '%lorem ipsum%' ORDER BY key`);

// T5-14 — unsubscribe promised vs linked
out.templates_unsub = await q(
  `SELECT count(*) FILTER (WHERE body ILIKE '%unsubscribe%')::int AS says_unsubscribe,
          count(*) FILTER (WHERE body ILIKE '%unsubscribe%' AND body ~* 'https?://')::int AS has_any_url,
          count(*) FILTER (WHERE body ~* 'unsubscribe[^\\n]{0,40}https?://|https?://[^\\s]*unsubscribe')::int AS has_unsub_link
   FROM message_templates WHERE channel='email'`);
out.sent_bodies_with_url = await q(
  `SELECT count(*)::int AS sent20_with_url FROM (
     SELECT rendered_body FROM messages WHERE direction='outbound' AND channel='email'
     ORDER BY created_at DESC LIMIT 20) t WHERE rendered_body ~* 'https?://'`);

// T5-08/12/16 — messages + addresses
out.messages_cols = await q(
  `SELECT column_name FROM information_schema.columns WHERE table_name='messages' ORDER BY ordinal_position`);
out.messages_by_status = await q(
  `SELECT channel, provider, status, count(*)::int AS n,
          count(*) FILTER (WHERE to_address IS NULL)::int AS no_to_address
   FROM messages GROUP BY 1,2,3 ORDER BY 1,2,3`);
out.messages_email_terminal = await q(
  `SELECT status, count(*)::int AS n FROM messages
   WHERE channel='email' AND direction='outbound' GROUP BY 1 ORDER BY 2 DESC`);
out.test_client_contact = await q(
  `SELECT id, (email IS NOT NULL AND email<>'') AS has_email,
          (phone IS NOT NULL AND phone<>'') AS has_phone
   FROM clients WHERE id=$1`, [TEST_CLIENT]);

// T5-04/13 — identity collisions. Counts only, never an address.
out.dup_emails = await q(
  `SELECT count(*)::int AS emails_shared_by_more_than_one_client FROM (
     SELECT lower(email) e FROM clients WHERE email IS NOT NULL AND email<>''
     GROUP BY 1 HAVING count(*) > 1) t`);
out.test_inbox_resolves = inbox
  ? await q(`SELECT count(*)::int AS matches,
                    bool_or(id = $2) AS includes_real_credit_file,
                    (array_agg(id ORDER BY created_at ASC))[1] = $2 AS oldest_is_real_credit_file
             FROM clients WHERE lower(email) = lower($1)`, [inbox, FORBIDDEN])
  : { ok: false, error: "FUNDHUB_TEST_INBOX not set locally" };
out.test_phone_resolves = phone
  ? await q(`SELECT count(*)::int AS matches, bool_or(id = $2) AS includes_real_credit_file
             FROM clients WHERE phone = $1`, [phone, FORBIDDEN])
  : { ok: false, error: "FUNDHUB_TEST_PHONE not set locally" };
out.phone_format_spread = await q(
  `SELECT count(*) FILTER (WHERE phone ~ '^\\+[0-9]+$')::int AS e164,
          count(*) FILTER (WHERE phone IS NOT NULL AND phone<>'' AND phone !~ '^\\+[0-9]+$')::int AS not_e164
   FROM clients`);

// T5-05/06/17 — inbound
out.inbound_messages = await q(
  `SELECT channel, count(*)::int AS n FROM messages WHERE direction='inbound' GROUP BY 1 ORDER BY 1`);
out.inbound_events = await q(
  `SELECT type, count(*)::int AS n FROM events WHERE type IN ('message.inbound','mail.response')
   GROUP BY 1 ORDER BY 1`);

// T5-10 — GHL leftovers
out.ghl = await q(
  `SELECT count(*)::int AS clients,
          count(*) FILTER (WHERE ghl_contact_id IS NOT NULL)::int AS with_ghl_id
   FROM clients`);

fs.writeFileSync(path.join(OUT, "db.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 7000));
await c.end();

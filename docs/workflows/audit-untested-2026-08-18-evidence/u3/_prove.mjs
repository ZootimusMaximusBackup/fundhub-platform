// U3 live prove — sanitized. No inbox, phone, keys, or client PII.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const SIM = "cb6f5839-2979-491d-9080-00ca51833b07";

function loadEnv() {
  const raw = readFileSync(resolve(ROOT, ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m) continue;
    if (process.env[m[1]] != null && process.env[m[1]] !== "") continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

function dump(name, obj) {
  writeFileSync(resolve(HERE, name), JSON.stringify(obj, null, 2) + "\n");
}

function snippetAround(text, needle) {
  const s = String(text || "");
  const i = s.toLowerCase().indexOf(needle);
  if (i < 0) return null;
  const start = Math.max(0, i - 40);
  const end = Math.min(s.length, i + needle.length + 80);
  return s.slice(start, end).replace(/\s+/g, " ").trim();
}

loadEnv();
mkdirSync(HERE, { recursive: true });

const doors = {};
for (const path of ["/api/unsubscribe", "/unsubscribe", "/app/unsubscribe.html"]) {
  try {
    const res = await fetch("https://fundhub.ai" + path, { method: "GET" });
    doors[path] = { status: res.status, ok: res.ok };
  } catch {
    doors[path] = { error: "fetch_failed" };
  }
}
dump("00-unsub-doors.json", doors);

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const templates = await db.query(`
  SELECT template_key, channel,
         body ~* 'https?://[^\\s\"'']+unsubscribe' AS has_http_unsub_url,
         body ILIKE '%/api/unsubscribe%' AS has_api_unsub,
         body ILIKE '%fundhub.ai/unsubscribe%' AS has_site_unsub,
         body ILIKE '%list-unsubscribe%' AS has_list_unsub_header_text,
         body ILIKE '%unsubscribe%' AS has_word_unsubscribe,
         body ILIKE '%opt out%' OR body ILIKE '%opt-out%' AS has_opt_out
    FROM message_templates
   WHERE channel = 'email'
`);

const withUrl = templates.rows.filter((t) => t.has_http_unsub_url || t.has_api_unsub || t.has_site_unsub);
const withWord = templates.rows.filter((t) => t.has_word_unsubscribe);

const samples = await db.query(`
  SELECT template_key, body
    FROM message_templates
   WHERE channel = 'email' AND body ILIKE '%unsubscribe%'
   ORDER BY template_key
   LIMIT 8
`);

dump("01-templates.json", {
  email_template_count: templates.rows.length,
  with_unsubscribe_word: withWord.length,
  with_http_unsub_url: templates.rows.filter((t) => t.has_http_unsub_url).map((t) => t.template_key),
  with_api_unsub: templates.rows.filter((t) => t.has_api_unsub).map((t) => t.template_key),
  with_site_unsub: templates.rows.filter((t) => t.has_site_unsub).map((t) => t.template_key),
  with_list_unsub_text: templates.rows.filter((t) => t.has_list_unsub_header_text).map((t) => t.template_key),
  with_opt_out_word: templates.rows.filter((t) => t.has_opt_out).map((t) => t.template_key),
  word_snippets: samples.rows.map((r) => ({
    template_key: r.template_key,
    snippet: snippetAround(r.body, "unsubscribe")
  }))
});

const named = ["CONTRACT-SEND-EMAIL", "CONTRACT-REMIND-EMAIL", "EMAIL-PORTAL-MAGIC-LINK"];
const namedRows = await db.query(`
  SELECT template_key,
         body ILIKE '%unsubscribe%' AS has_word,
         body ~* 'https?://' AS has_any_http,
         body ILIKE '%reply to this email%' AS says_reply_to_this_email
    FROM message_templates
   WHERE template_key = ANY($1)
`, [named]);
dump("02-named-templates.json", { rows: namedRows.rows });

const sent = await db.query(`
  SELECT template_key,
         rendered_body ILIKE '%unsubscribe%' AS body_has_word,
         rendered_body ~* 'https?://[^\\s\"'']+unsubscribe' AS body_has_http_unsub,
         rendered_body ILIKE '%/api/unsubscribe%' AS body_has_api_unsub,
         created_at
    FROM messages
   WHERE channel = 'email' AND direction = 'outbound'
   ORDER BY created_at DESC
   LIMIT 20
`);
dump("03-sent-bodies.json", { latest_20: sent.rows });

const opt = await db.query(`
  SELECT channel, source, count(*)::int AS n
    FROM opt_outs
   GROUP BY channel, source
`);
const optTotal = await db.query(`SELECT count(*)::int AS n FROM opt_outs`);
const dnd = await db.query(`
  SELECT
    count(*) FILTER (WHERE dnd_email) ::int AS dnd_email_true,
    count(*) FILTER (WHERE id = $1::uuid AND dnd_email) ::int AS live_dnd_email,
    count(*) FILTER (WHERE id = $2::uuid AND dnd_email) ::int AS test_dnd_email,
    count(*) FILTER (WHERE id = $3::uuid AND dnd_email) ::int AS sim_dnd_email
  FROM clients
`, [LIVE, TEST, SIM]);
dump("04-opt-outs.json", {
  opt_outs_total: optTotal.rows[0].n,
  by_channel_source: opt.rows,
  dnd: dnd.rows[0]
});

const decision = {
  outbound_has_unsubscribe_link: sent.rows.some((r) => r.body_has_http_unsub || r.body_has_api_unsub)
    || withUrl.length > 0,
  live_unsub_page: doors,
  email_STOP_writes_opt_outs: false,
  email_STOP_guard: "src/handlers/comms.mjs onMessageInbound — STOP keywords only when channel === sms",
  mailgun_unsubscribed_ignored: true,
  mailgun_unsubscribed_file: "src/adapters/mailgun.mjs IGNORED_DELIVERY_EVENTS",
  only_email_opt_out_path: "Mailgun event=complained → opt_outs channel=email source=provider_complaint",
  opt_outs_rows: optTotal.rows[0].n,
  safe_click_exists: false,
  clicked: false,
  emailed_STOP: false,
  why_no_click_or_send: [
    "No unsubscribe URL in live email templates or the last 20 sent bodies.",
    "GET /api/unsubscribe and /unsubscribe are 404.",
    "A STOP email from the bare inbox would match the live file. Forbidden.",
    "A STOP email would also miss Mailgun (Resend From is fundhub.ai / Cloudflare).",
    "Even if STOP landed as email inbound, the handler ignores STOP unless channel is sms."
  ]
};
dump("05-decision.json", decision);

await db.end();
console.log("u3 prove wrote sanitized dumps");

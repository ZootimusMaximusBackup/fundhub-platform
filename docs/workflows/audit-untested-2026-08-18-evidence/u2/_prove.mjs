// U2 live prove — sanitized dumps only. Never prints inbox, phone, or keys.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
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

function addrKind(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return { present: false, kind: "empty" };
  const bracketed = /<([^>]+)>/.exec(s);
  const address = (bracketed ? bracketed[1] : s).trim();
  const at = address.lastIndexOf("@");
  const local = at >= 0 ? address.slice(0, at) : address;
  const domain = at >= 0 ? address.slice(at + 1) : "";
  return {
    present: true,
    kind: local.includes("+") ? "plus_tag" : "plain",
    domain,
    local_has_plus: local.includes("+"),
    is_mg_domain: domain === "mg.fundhub.ai",
    is_fundhub_domain: domain === "fundhub.ai",
    is_gmail: domain === "gmail.com"
  };
}

function mxKind(host) {
  try {
    const out = execFileSync("dig", ["+short", "MX", host], { encoding: "utf8" });
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
    const joined = lines.join(" ").toLowerCase();
    let kind = "other";
    if (/mailgun/.test(joined)) kind = "mailgun";
    else if (/cloudflare|mx\.cloudflare/.test(joined)) kind = "cloudflare";
    else if (/google|aspmx|gmail/.test(joined)) kind = "google";
    return {
      host,
      kind,
      record_count: lines.length,
      mentions_mailgun: /mailgun/.test(joined),
      mentions_cloudflare: /cloudflare/.test(joined)
    };
  } catch {
    return { host, kind: "lookup_failed", record_count: 0 };
  }
}

function redactRoutes(json) {
  const items = json.items || [];
  return items.map((r) => ({
    id: r.id || null,
    priority: r.priority ?? null,
    description: r.description || null,
    expression_is_catch_all: String(r.expression || "") === "catch_all()",
    expression_kind: /match_recipient/i.test(String(r.expression || ""))
      ? "match_recipient"
      : (String(r.expression || "") === "catch_all()" ? "catch_all" : "other"),
    actions: (r.actions || []).map((a) => {
      const s = String(a);
      return {
        kind: /^forward/i.test(s) ? "forward" : (/^store/i.test(s) ? "store" : (/^stop/i.test(s) ? "stop" : "other")),
        points_live_webhook: /fundhub\.ai\/api\/webhooks\/mailgun/i.test(s),
        points_webhooks_mailgun: /\/api\/webhooks\/mailgun/i.test(s)
      };
    })
  }));
}

async function query(client, sql, params = []) {
  const r = await client.query(sql, params);
  return r.rows;
}

loadEnv();
mkdirSync(HERE, { recursive: true });

const inbox = String(process.env.FUNDHUB_TEST_INBOX || "").trim().toLowerCase();
const at = inbox.lastIndexOf("@");
const plusTag = at >= 0 ? `${inbox.slice(0, at)}+u2audit@${inbox.slice(at + 1)}` : "";
const resendFrom = String(process.env.RESEND_FROM || "");
const mailgunFrom = String(process.env.MAILGUN_SEND_FROM || process.env.MAILGUN_FROM || "");

const envNames = {
  FUNDHUB_TEST_INBOX_set: Boolean(inbox),
  FUNDHUB_TEST_PHONE_set: Boolean(process.env.FUNDHUB_TEST_PHONE),
  DATABASE_URL_set: Boolean(process.env.DATABASE_URL),
  RESEND_API_KEY_set: Boolean(process.env.RESEND_API_KEY),
  RESEND_FROM_set: Boolean(resendFrom),
  RESEND_FROM_kind: addrKind(resendFrom),
  MAILGUN_SEND_API_KEY_set: Boolean(process.env.MAILGUN_SEND_API_KEY || process.env.MAILGUN_API_KEY),
  MAILGUN_SEND_DOMAIN: process.env.MAILGUN_SEND_DOMAIN || null,
  MAILGUN_SEND_FROM_set: Boolean(mailgunFrom),
  MAILGUN_SEND_FROM_kind: addrKind(mailgunFrom),
  MAILGUN_SIGNING_KEY_set: Boolean(process.env.MAILGUN_SIGNING_KEY),
  STAFF_E2E_PASSWORD_set: Boolean(process.env.STAFF_E2E_PASSWORD)
};
dump("00-env-names.json", envNames);

const mx = {
  "fundhub.ai": mxKind("fundhub.ai"),
  "mg.fundhub.ai": mxKind("mg.fundhub.ai")
};
dump("01-mx.json", mx);

const webhook = { get: null, head: null, post_empty: null };
for (const method of ["GET", "HEAD"]) {
  try {
    const res = await fetch("https://fundhub.ai/api/webhooks/mailgun", { method });
    webhook[method.toLowerCase()] = { status: res.status, ok: res.ok };
  } catch (err) {
    webhook[method.toLowerCase()] = { error: "fetch_failed" };
  }
}
try {
  const res = await fetch("https://fundhub.ai/api/unsubscribe", { method: "GET" });
  webhook.unsubscribe_get = { status: res.status, ok: res.ok };
} catch {
  webhook.unsubscribe_get = { error: "fetch_failed" };
}
dump("02-live-doors.json", webhook);

const key = process.env.MAILGUN_SEND_API_KEY || process.env.MAILGUN_API_KEY || "";
const routesOut = {
  routes_http: null,
  routes_total: null,
  has_route_to_live_webhook: false,
  routes: [],
  error: null
};
if (key) {
  const auth = "Basic " + Buffer.from(`api:${key}`).toString("base64");
  try {
    const res = await fetch("https://api.mailgun.net/v3/routes", { headers: { authorization: auth } });
    const json = await res.json().catch(() => ({}));
    routesOut.routes_http = res.status;
    routesOut.routes_total = json.total_count ?? (Array.isArray(json.items) ? json.items.length : null);
    routesOut.routes = redactRoutes(json);
    routesOut.has_route_to_live_webhook = routesOut.routes.some((r) =>
      (r.actions || []).some((a) => a.points_live_webhook)
    );
  } catch {
    routesOut.error = "routes_fetch_failed";
  }
} else {
  routesOut.error = "MAILGUN_SEND_API_KEY missing";
}
dump("03-mailgun-routes.json", routesOut);

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const routing = await query(db, `
  SELECT channel, provider, enabled
    FROM message_channel_routing
   ORDER BY channel
`);
dump("04-routing.json", { rows: routing });

const outbound = await query(db, `
  SELECT provider, status, template_key,
         to_address IS NOT NULL AS has_to,
         created_at
    FROM messages
   WHERE channel = 'email' AND direction = 'outbound'
   ORDER BY created_at DESC
   LIMIT 20
`);
const providerCounts = await query(db, `
  SELECT provider, status, count(*)::int AS n
    FROM messages
   WHERE channel = 'email' AND direction = 'outbound'
   GROUP BY provider, status
   ORDER BY n DESC
`);
dump("05-outbound-email.json", { latest_20: outbound, provider_status_counts: providerCounts });

const clients = await query(db, `
  SELECT
    id = $1::uuid AS is_live_file,
    id = $2::uuid AS is_test_file,
    id = $3::uuid AS is_p3_sim,
    COALESCE(is_demo, false) AS is_demo,
    lower(email) = $4 AS email_eq_bare_inbox,
    lower(email) = $5 AS email_eq_plus_tag,
    position('+' in coalesce(email, '')) > 0 AS email_has_plus,
    split_part(lower(coalesce(email, '')), '@', 2) AS email_domain,
    phone IS NOT NULL AND btrim(phone) <> '' AS has_phone
  FROM clients
  WHERE id IN ($1::uuid, $2::uuid, $3::uuid)
     OR lower(email) = $4
     OR lower(email) = $5
     OR position('+' in coalesce(email, '')) > 0
`, [LIVE, TEST, SIM, inbox, plusTag]);

const plusClients = clients.filter((c) => c.email_has_plus);
const bareMatches = clients.filter((c) => c.email_eq_bare_inbox);
dump("06-collision.json", {
  live_file_email_eq_bare_inbox: bareMatches.some((c) => c.is_live_file),
  any_client_email_eq_bare_inbox: bareMatches.length > 0,
  bare_match_count: bareMatches.length,
  bare_match_is_only_live: bareMatches.length === 1 && bareMatches[0].is_live_file,
  plus_tag_used_for_probe: "inbox-local+u2audit@same-host",
  any_client_email_eq_u2_plus_tag: clients.some((c) => c.email_eq_plus_tag),
  any_client_has_plus_in_email: plusClients.length > 0,
  plus_client_count: plusClients.length,
  plus_clients_are_demo: plusClients.map((c) => ({
    is_live_file: c.is_live_file,
    is_test_file: c.is_test_file,
    is_p3_sim: c.is_p3_sim,
    is_demo: c.is_demo,
    email_domain: c.email_domain
  })),
  named_clients: clients
    .filter((c) => c.is_live_file || c.is_test_file || c.is_p3_sim)
    .map((c) => ({
      is_live_file: c.is_live_file,
      is_test_file: c.is_test_file,
      is_p3_sim: c.is_p3_sim,
      is_demo: c.is_demo,
      email_eq_bare_inbox: c.email_eq_bare_inbox,
      email_has_plus: c.email_has_plus,
      email_domain: c.email_domain,
      has_phone: c.has_phone
    }))
});

const events = await query(db, `
  SELECT name, count(*)::int AS n
    FROM events
   WHERE name IN ('message.inbound', 'mail.response')
   GROUP BY name
`);
const inboundMsgs = await query(db, `
  SELECT channel, provider, status, count(*)::int AS n
    FROM messages
   WHERE direction = 'inbound'
   GROUP BY channel, provider, status
`);
dump("07-inbound.json", { event_counts: events, inbound_message_counts: inboundMsgs });

const templates = await query(db, `
  SELECT template_key, channel,
         body ILIKE '%unsubscribe%' AS body_has_unsubscribe,
         body ILIKE '%opt out%' OR body ILIKE '%opt-out%' AS body_has_opt_out,
         body ILIKE '%list-unsubscribe%' AS body_has_list_unsubscribe,
         subject ILIKE '%unsubscribe%' AS subject_has_unsubscribe
    FROM message_templates
   WHERE channel = 'email'
`);
dump("08-email-templates-unsub.json", {
  email_template_count: templates.length,
  with_unsubscribe_word: templates.filter((t) => t.body_has_unsubscribe).map((t) => t.template_key),
  with_opt_out_word: templates.filter((t) => t.body_has_opt_out).map((t) => t.template_key),
  with_list_unsubscribe: templates.filter((t) => t.body_has_list_unsubscribe).map((t) => t.template_key)
});

const optOuts = await query(db, `
  SELECT channel, source, count(*)::int AS n
    FROM opt_outs
   GROUP BY channel, source
`);
dump("09-opt-outs.json", { rows: optOuts });

const sendDecision = {
  gmail_reply_from_is_bare_inbox: true,
  bare_inbox_matches_live_file: bareMatches.some((c) => c.is_live_file),
  resolveClientFromSender_is_exact_lower_email: true,
  plus_tag_would_not_match_live_file: !clients.some((c) => c.email_eq_plus_tag && c.is_live_file),
  plus_tag_stored_on_any_client: clients.some((c) => c.email_eq_plus_tag),
  outbound_from_domain_is_fundhub_ai: envNames.RESEND_FROM_kind.is_fundhub_domain,
  reply_to_that_from_hits: mx["fundhub.ai"].kind,
  mailgun_inbound_only_hears: mx["mg.fundhub.ai"].kind === "mailgun" ? "mg.fundhub.ai" : mx["mg.fundhub.ai"].kind,
  safe_to_send_gmail_reply: false,
  why_not_sent: [
    "Gmail Reply From is the bare FUNDHUB_TEST_INBOX.",
    "That address is the live file. resolveClientFromSender exact-matches lower(email).",
    "A send would attach the reply to client 9af65808-… . Forbidden.",
    "Plus-tag From is not a Gmail Reply default, and no client stores the u2 plus-tag.",
    "Even a plus-tag From to the outbound From address would hit Cloudflare (fundhub.ai), not Mailgun."
  ]
};
dump("10-send-decision.json", sendDecision);

await db.end();
console.log("u2 prove wrote sanitized dumps");

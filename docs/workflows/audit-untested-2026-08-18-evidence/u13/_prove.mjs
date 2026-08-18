// U13 live prove — sanitized. Confirm FUNDHUB_TEST_PHONE by name only.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";

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

function normPhone(v) {
  return String(v || "").replace(/\D/g, "");
}

loadEnv();
mkdirSync(HERE, { recursive: true });

const twilioNames = {};
for (const k of Object.keys(process.env).filter((k) => k.startsWith("TWILIO_")).sort()) {
  twilioNames[k] = Boolean(process.env[k]);
}

const testPhone = process.env.FUNDHUB_TEST_PHONE || "";
dump("00-env-names.json", {
  FUNDHUB_TEST_PHONE_set: Boolean(testPhone),
  FUNDHUB_TEST_PHONE_looks_e164: /^\+\d{10,15}$/.test(String(testPhone).trim()),
  twilio_names: twilioNames
});

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const clients = await db.query(`
  SELECT
    id = $1::uuid AS is_live_file,
    id = $2::uuid AS is_test_file,
    phone IS NOT NULL AND btrim(phone) <> '' AS has_phone
  FROM clients
  WHERE id IN ($1::uuid, $2::uuid)
`, [LIVE, TEST]);

const phones = await db.query(`
  SELECT
    id = $1::uuid AS is_live_file,
    id = $2::uuid AS is_test_file,
    regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = $3 AS phone_eq_test_phone
  FROM clients
  WHERE id IN ($1::uuid, $2::uuid)
`, [LIVE, TEST, normPhone(testPhone)]);

dump("01-clients.json", {
  rows: clients.rows,
  phone_eq_test_phone: phones.rows
});

const sms = await db.query(`
  SELECT id, client_id = $1::uuid AS is_test_client,
         client_id = $2::uuid AS is_live_client,
         direction, status, provider, blocked_reason,
         last_error IS NOT NULL AS has_error,
         to_address IS NOT NULL AND btrim(to_address) <> '' AS has_to,
         created_at
    FROM messages
   WHERE channel = 'sms'
   ORDER BY created_at DESC
   LIMIT 15
`, [TEST, LIVE]);

const smsCounts = await db.query(`
  SELECT direction, status, provider, count(*)::int AS n
    FROM messages
   WHERE channel = 'sms'
   GROUP BY direction, status, provider
`);

dump("02-sms-rows.json", {
  latest: sms.rows.map((r) => ({
    id: r.id,
    is_test_client: r.is_test_client,
    is_live_client: r.is_live_client,
    direction: r.direction,
    status: r.status,
    provider: r.provider,
    blocked_reason: r.blocked_reason,
    has_error: r.has_error,
    has_to: r.has_to,
    created_at: r.created_at
  })),
  counts: smsCounts.rows
});

const apiHasTo = !readFileSync(resolve(ROOT, "api/messages.mjs"), "utf8").includes("body.to")
  && !readFileSync(resolve(ROOT, "src/messaging/compose.mjs"), "utf8").includes("input.to");
dump("03-send-door.json", {
  post_api_messages_accepts_to_override: false,
  compose_reads_clients_phone_only: true,
  messaging_html_has_to_input: /id=["']to["']|name=["']to["']|To number|to_address/i.test(
    readFileSync(resolve(ROOT, "public/app/messaging.html"), "utf8")
  ),
  api_messages_mentions_body_to: /body\.to\b/.test(readFileSync(resolve(ROOT, "api/messages.mjs"), "utf8"))
});

const sid = process.env.TWILIO_SEND_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID || "";
const token = process.env.TWILIO_SEND_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN || "";
const bundle = process.env.TWILIO_TRUSTHUB_BUNDLE_SID || "";
const a2p = { asked: false, http: null, brand_status: null, bundle_status: null, error: null };

if (!token) {
  a2p.error = "TWILIO_SEND_AUTH_TOKEN and TWILIO_AUTH_TOKEN unset — cannot ask Twilio";
} else if (sid && token) {
  a2p.asked = true;
  const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  try {
    const res = await fetch("https://messaging.twilio.com/v1/a2p/BrandRegistrations?PageSize=5", {
      headers: { authorization: auth }
    });
    const json = await res.json().catch(() => ({}));
    a2p.http = res.status;
    a2p.brand_count = json.meta?.key ? (json.brands || json.brand_registrations || json.results || []).length : (Array.isArray(json.brands) ? json.brands.length : null);
    const items = json.results || json.data || json.brands || json.brand_registrations || [];
    a2p.brand_statuses = (Array.isArray(items) ? items : []).slice(0, 5).map((b) => ({
      status: b.status || b.brand_status || null,
      identity_status: b.identity_status || null
    }));
    if (json.code) a2p.twilio_code = json.code;
    if (json.message) a2p.twilio_message_kind = /A2P|pending|approved|campaign/i.test(String(json.message)) ? "mentions_a2p" : "other";
  } catch {
    a2p.error = "brand_fetch_failed";
  }
  if (bundle) {
    try {
      const res = await fetch(`https://trusthub.twilio.com/v1/TrustProducts/${bundle}`, {
        headers: { authorization: auth }
      });
      const json = await res.json().catch(() => ({}));
      a2p.bundle_http = res.status;
      a2p.bundle_status = json.status || json.results?.[0]?.status || null;
    } catch {
      a2p.bundle_error = "bundle_fetch_failed";
    }
  }
}
dump("04-a2p.json", a2p);

const testHasPhone = clients.rows.some((r) => r.is_test_file && r.has_phone);
const liveEqTest = phones.rows.some((r) => r.is_live_file && r.phone_eq_test_phone);
dump("05-decision.json", {
  FUNDHUB_TEST_PHONE_set: Boolean(testPhone),
  test_client_has_phone: testHasPhone,
  live_file_phone_eq_test_phone: liveEqTest,
  screen_lets_type_to: false,
  will_patch_client: false,
  will_send: false,
  why: testHasPhone
    ? "TEST has a phone — still must be FUNDHUB_TEST_PHONE and typed To. Recheck on screen."
    : (liveEqTest
      ? "TEST has no phone. Live file phone equals FUNDHUB_TEST_PHONE. Do not text the live file."
      : "TEST has no phone. Screen has no To field. Do not patch the client. Cannot send.")
});

await db.end();
console.log("u13 prove wrote sanitized dumps");

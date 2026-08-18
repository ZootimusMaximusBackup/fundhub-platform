// F-SMS one send — TEST client only. Never prints phones, tokens, or secrets.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const LIVE_FILE = "9af65808-a619-4e65-ae91-239766a006b7";
const BODY = "Fundhub e2e ping — ignore.";
const ORIGIN = "https://fundhub.ai";

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

function digits(v) {
  return String(v || "").replace(/\D/g, "");
}

function scrub(value) {
  if (value == null) return value;
  if (typeof value !== "string") {
    try {
      return JSON.parse(scrub(JSON.stringify(value)));
    } catch {
      return "[unprintable]";
    }
  }
  return value
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[phone]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]");
}

loadEnv();
mkdirSync(HERE, { recursive: true });

const testPhone = String(process.env.FUNDHUB_TEST_PHONE || "").trim();
const password = String(process.env.STAFF_E2E_PASSWORD || "");
if (!testPhone) throw new Error("FUNDHUB_TEST_PHONE missing");
if (!password) throw new Error("STAFF_E2E_PASSWORD missing");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const before = await db.query(
  `SELECT
     phone IS NOT NULL AND btrim(phone) <> '' AS has_phone,
     regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = $2 AS phone_eq_FUNDHUB_TEST_PHONE
   FROM clients
   WHERE id = $1::uuid`,
  [TEST, digits(testPhone)]
);

let phonePatched = false;
if (!before.rows[0]?.phone_eq_FUNDHUB_TEST_PHONE) {
  await db.query(
    `UPDATE clients
        SET phone = $2
      WHERE id = $1::uuid`,
    [TEST, testPhone]
  );
  phonePatched = true;
}

const afterPatch = await db.query(
  `SELECT
     phone IS NOT NULL AND btrim(phone) <> '' AS has_phone,
     regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = $2 AS phone_eq_FUNDHUB_TEST_PHONE
   FROM clients
   WHERE id = $1::uuid`,
  [TEST, digits(testPhone)]
);

dump("02-test-phone.json", {
  queried_live_file: false,
  wrote_live_file: false,
  test_id: TEST,
  patched_test_phone: phonePatched,
  before: before.rows[0] || null,
  after: afterPatch.rows[0] || null
});

async function login(email) {
  const res = await fetch(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json().catch(() => ({}));
  return {
    email_kind: email.startsWith("owner@") ? "owner@" : (email.startsWith("chris@") ? "chris@" : "other"),
    status: res.status,
    ok: Boolean(res.ok && data.ok),
    has_token: Boolean(data.token),
    principal: data.principal || null,
    role: data.staff?.role || null,
    token: data.token || null,
    error: data.error || null
  };
}

let auth = await login("chris@fundhub.ai");
if (!auth.ok) auth = await login("owner@fundhub.ai");

dump("03-login.json", {
  ok: auth.ok,
  status: auth.status,
  email_kind: auth.email_kind,
  has_token: auth.has_token,
  principal: auth.principal,
  role: auth.role,
  error: auth.error
});

const sendOut = {
  attempted: false,
  http: null,
  outcome: null,
  detail: null,
  message_id: null,
  conversation_id: null,
  deduped: null,
  error: null,
  sent_count: 0
};

if (!auth.ok || !auth.token) {
  sendOut.error = "login_failed";
} else {
  sendOut.attempted = true;
  const res = await fetch(`${ORIGIN}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${auth.token}`
    },
    body: JSON.stringify({
      client_id: TEST,
      channel: "sms",
      body: BODY,
      idempotency_key: `f-sms-${Date.now()}`
    })
  });
  const data = await res.json().catch(() => ({}));
  sendOut.sent_count = 1;
  sendOut.http = res.status;
  sendOut.ok = Boolean(res.ok && data.ok);
  sendOut.outcome = data.outcome ?? null;
  sendOut.detail = scrub(data.detail || data.message || data.error || null);
  sendOut.message_id = data.message?.id || null;
  sendOut.conversation_id = data.conversation_id || data.message?.conversation_id || null;
  sendOut.deduped = data.deduped ?? null;
  sendOut.api_error = data.error || null;
}

dump("04-send.json", sendOut);

const rowQ = sendOut.message_id
  ? await db.query(
      `SELECT id, client_id = $2::uuid AS is_test_client,
              client_id = $3::uuid AS is_live_client,
              direction, channel, status, provider, blocked_reason,
              last_error IS NOT NULL AS has_error,
              provider_message_id IS NOT NULL AND btrim(coalesce(provider_message_id, '')) <> '' AS has_provider_id,
              CASE
                WHEN provider_message_id IS NULL OR btrim(provider_message_id) = '' THEN null
                WHEN provider_message_id LIKE 'SM%' THEN 'SM…'
                WHEN provider_message_id LIKE 'MM%' THEN 'MM…'
                ELSE 'other'
              END AS provider_id_kind,
              length(provider_message_id) AS provider_id_len,
              to_address IS NOT NULL AND btrim(to_address) <> '' AS has_to,
              regexp_replace(coalesce(to_address, ''), '\\D', '', 'g') = $4 AS to_eq_FUNDHUB_TEST_PHONE,
              rendered_body = $5 AS body_is_ping,
              created_at
         FROM messages
        WHERE id = $1::uuid`,
      [sendOut.message_id, TEST, LIVE_FILE, digits(testPhone), BODY]
    )
  : await db.query(
      `SELECT id, client_id = $1::uuid AS is_test_client,
              client_id = $2::uuid AS is_live_client,
              direction, channel, status, provider, blocked_reason,
              last_error IS NOT NULL AS has_error,
              provider_message_id IS NOT NULL AND btrim(coalesce(provider_message_id, '')) <> '' AS has_provider_id,
              CASE
                WHEN provider_message_id IS NULL OR btrim(provider_message_id) = '' THEN null
                WHEN provider_message_id LIKE 'SM%' THEN 'SM…'
                WHEN provider_message_id LIKE 'MM%' THEN 'MM…'
                ELSE 'other'
              END AS provider_id_kind,
              length(provider_message_id) AS provider_id_len,
              to_address IS NOT NULL AND btrim(to_address) <> '' AS has_to,
              regexp_replace(coalesce(to_address, ''), '\\D', '', 'g') = $3 AS to_eq_FUNDHUB_TEST_PHONE,
              rendered_body = $4 AS body_is_ping,
              created_at
         FROM messages
        WHERE client_id = $1::uuid
          AND channel = 'sms'
          AND rendered_body = $4
        ORDER BY created_at DESC
        LIMIT 1`,
      [TEST, LIVE_FILE, digits(testPhone), BODY]
    );

const errQ = rowQ.rows[0]
  ? await db.query(
      `SELECT $1::text AS last_error_scrubbed
         FROM messages
        WHERE id = $2::uuid`,
      [null, rowQ.rows[0].id]
    )
  : { rows: [] };

let lastErrorScrubbed = null;
if (rowQ.rows[0]) {
  const err = await db.query(
    `SELECT last_error FROM messages WHERE id = $1::uuid`,
    [rowQ.rows[0].id]
  );
  lastErrorScrubbed = scrub(err.rows[0]?.last_error || null);
}

dump("05-message-row.json", {
  queried_live_file: false,
  row: rowQ.rows[0] || null,
  last_error_scrubbed: lastErrorScrubbed
});

await db.end();
console.log("f-sms send wrote sanitized dumps");

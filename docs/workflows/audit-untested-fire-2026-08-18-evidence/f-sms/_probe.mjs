// F-SMS probe — names only. Never prints phones, tokens, or secrets.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
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

function setName(k) {
  return Boolean(String(process.env[k] || "").trim());
}

function digits(v) {
  return String(v || "").replace(/\D/g, "");
}

loadEnv();
mkdirSync(HERE, { recursive: true });

const testPhone = String(process.env.FUNDHUB_TEST_PHONE || "").trim();
const twilioNames = {};
for (const k of Object.keys(process.env).filter((k) => k.startsWith("TWILIO_")).sort()) {
  twilioNames[k] = setName(k);
}

dump("00-env-names.json", {
  FUNDHUB_TEST_PHONE_set: setName("FUNDHUB_TEST_PHONE"),
  FUNDHUB_TEST_PHONE_looks_e164: /^\+\d{10,15}$/.test(testPhone),
  TWILIO_ACCOUNT_SID: setName("TWILIO_ACCOUNT_SID"),
  TWILIO_AUTH_TOKEN: setName("TWILIO_AUTH_TOKEN"),
  TWILIO_SEND_FROM: setName("TWILIO_SEND_FROM"),
  TWILIO_SEND_ACCOUNT_SID: setName("TWILIO_SEND_ACCOUNT_SID"),
  TWILIO_SEND_AUTH_TOKEN: setName("TWILIO_SEND_AUTH_TOKEN"),
  MESSAGING_DRY_RUN_set: setName("MESSAGING_DRY_RUN"),
  MESSAGING_DRY_RUN_is_explicit_off: ["0", "false", "no", "off"].includes(
    String(process.env.MESSAGING_DRY_RUN || "").trim().toLowerCase()
  ),
  STAFF_E2E_PASSWORD_set: setName("STAFF_E2E_PASSWORD"),
  DATABASE_URL_set: setName("DATABASE_URL"),
  twilio_names: twilioNames
});

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const client = await db.query(
  `SELECT
     id = $1::uuid AS is_test,
     phone IS NOT NULL AND btrim(phone) <> '' AS has_phone,
     regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = $2 AS phone_eq_FUNDHUB_TEST_PHONE,
     (custom_fields ->> 'synthetic') IS NOT NULL AS has_synthetic_field,
     (custom_fields ->> 'synthetic') = 'true' OR (custom_fields -> 'synthetic') = 'true'::jsonb AS synthetic_true,
     org_id IS NOT NULL AS has_org
   FROM clients
   WHERE id = $1::uuid`,
  [TEST, digits(testPhone)]
);

const opt = await db.query(
  `SELECT channel, opted_in_at IS NOT NULL AS opted_back_in
     FROM opt_outs
    WHERE client_id = $1::uuid`,
  [TEST]
);

const routing = await db.query(
  `SELECT channel, provider, enabled
     FROM message_channel_routing
    WHERE channel = 'sms'`
);

const recent = await db.query(
  `SELECT id, direction, status, provider,
          last_error IS NOT NULL AS has_error,
          provider_message_id IS NOT NULL AND btrim(provider_message_id) <> '' AS has_provider_id,
          to_address IS NOT NULL AND btrim(to_address) <> '' AS has_to,
          created_at
     FROM messages
    WHERE client_id = $1::uuid AND channel = 'sms'
    ORDER BY created_at DESC
    LIMIT 8`,
  [TEST]
);

dump("01-test-client.json", {
  queried_live_file: false,
  test: client.rows[0] || null,
  opt_outs: opt.rows,
  sms_routing: routing.rows,
  recent_test_sms: recent.rows
});

await db.end();
console.log("f-sms probe wrote sanitized dumps");

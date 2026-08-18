// U1 — boolean-only DB probe. No emails, tokens, or secrets printed.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-2026-08-18-evidence/u1");
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
loadDotEnv();

const inbox = String(process.env.FUNDHUB_TEST_INBOX || "").trim().toLowerCase();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
if (!inbox) throw new Error("FUNDHUB_TEST_INBOX missing");
fs.mkdirSync(OUT, { recursive: true });

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();

const emails = await c.query(
  `SELECT
     (SELECT count(*)::int FROM clients WHERE id = $1::uuid) AS test_found,
     (SELECT count(*)::int FROM clients WHERE id = $2::uuid) AS live_found,
     (SELECT lower(email) = $3 FROM clients WHERE id = $1::uuid) AS test_email_eq_inbox,
     (SELECT lower(email) = $3 FROM clients WHERE id = $2::uuid) AS live_email_eq_inbox,
     (SELECT email IS NOT NULL AND length(trim(email)) > 0 FROM clients WHERE id = $1::uuid) AS test_has_email,
     (SELECT email IS NOT NULL AND length(trim(email)) > 0 FROM clients WHERE id = $2::uuid) AS live_has_email,
     (SELECT lower(split_part(email, '@', 2)) = 'fundhub.ai' FROM clients WHERE id = $1::uuid) AS test_email_is_fundhub_ai_domain`,
  [TEST, LIVE, inbox]
);

const plus = await c.query(
  `SELECT count(*)::int AS n
     FROM clients
    WHERE id <> $2::uuid
      AND email IS NOT NULL
      AND lower(email) LIKE '%+%'
      AND lower(split_part(email, '@', 2)) = lower(split_part($1, '@', 2))
      AND lower(split_part(split_part(email, '@', 1), '+', 1))
          = lower(split_part(split_part($1, '@', 1), '+', 1))`,
  [inbox, LIVE]
);

const e2e = await c.query(
  `SELECT count(*)::int AS n
     FROM clients
    WHERE id <> $1::uuid
      AND (
        lower(email) LIKE 'e2e+aff-%'
        OR lower(email) LIKE 'e2e+wl-%'
      )`,
  [LIVE]
);

const links = await c.query(
  `SELECT
     count(*)::int AS n,
     count(*) FILTER (WHERE consumed_at IS NULL AND expires_at > now())::int AS unconsumed_valid,
     count(*) FILTER (WHERE outcome = 'issued')::int AS issued,
     max(created_at) AS last_created
     FROM account_magic_links
    WHERE client_id = $1::uuid`,
  [TEST]
);

const recent = await c.query(
  `SELECT id, client_id, outcome,
          (consumed_at IS NOT NULL) AS consumed,
          (expires_at > now()) AS not_expired,
          (lower(email) = $2) AS email_eq_inbox,
          created_at
     FROM account_magic_links
    WHERE client_id = $1::uuid
    ORDER BY created_at DESC
    LIMIT 5`,
  [TEST, inbox]
);

const msgs = await c.query(
  `SELECT id, status, provider, attempts,
          (lower(to_address) = $2) AS to_address_eq_inbox,
          (lower(split_part(to_address, '@', 2)) = 'fundhub.ai') AS to_is_fundhub_ai,
          (client_id = $1::uuid) AS is_test_client,
          created_at
     FROM messages
    WHERE client_id = $1::uuid
      AND template_key = 'EMAIL-PORTAL-MAGIC-LINK'
    ORDER BY created_at DESC
    LIMIT 5`,
  [TEST, inbox]
);

await c.end();

const emailBooleans = {
  FUNDHUB_TEST_INBOX_set: true,
  test_client_found: emails.rows[0].test_found === 1,
  live_file_found: emails.rows[0].live_found === 1,
  test_email_eq_inbox: emails.rows[0].test_email_eq_inbox === true,
  live_email_eq_inbox: emails.rows[0].live_email_eq_inbox === true,
  test_email_is_fundhub_ai_domain: emails.rows[0].test_email_is_fundhub_ai_domain === true,
  test_has_email: emails.rows[0].test_has_email === true,
  live_has_email: emails.rows[0].live_has_email === true
};

const mailbox = {
  plus_tag_clients_not_live: plus.rows[0].n,
  e2e_aff_or_wl_clients_not_live: e2e.rows[0].n,
  safe_openable_mailbox_without_writing_live_email: false,
  why: "Test client mail is @fundhub.ai (not the watched inbox). Live file mail IS the watched inbox. No plus-tag or e2e+ client is treated as an openable mailbox here. Did not write any email onto any client."
};

if (plus.rows[0].n > 0) {
  mailbox.safe_openable_mailbox_without_writing_live_email = "unknown_plus_tag_exists";
  mailbox.why = "A plus-tag client exists that is not the live file. Still cannot open Gmail without a session. Did not request a new link.";
}

fs.writeFileSync(path.join(OUT, "db-email-booleans.json"), JSON.stringify(emailBooleans, null, 2));
fs.writeFileSync(path.join(OUT, "db-mailbox-options.json"), JSON.stringify(mailbox, null, 2));
fs.writeFileSync(path.join(OUT, "db-magic-link-rows.json"), JSON.stringify({
  test_client_counts: links.rows[0],
  recent: recent.rows
}, null, 2));
fs.writeFileSync(path.join(OUT, "db-queued-message-booleans.json"), JSON.stringify(msgs.rows, null, 2));

console.log(JSON.stringify({
  emailBooleans,
  mailbox,
  link_counts: links.rows[0],
  recent_msgs: msgs.rows.length
}));

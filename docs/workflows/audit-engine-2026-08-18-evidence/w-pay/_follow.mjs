// W-PAY follow — read-only. No emails printed. No emits.
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-pay");
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const COMPARE = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const THIS = "41a3199f-1835-4ac8-91c0-d4f37bd92037";
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";

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

const { db, close } = await import("../../../../src/db.mjs");

const who = (await db.query(`SELECT current_user, current_setting('role', true) AS role`)).rows[0];

const eventVisibility = (await db.query(
  `SELECT
     count(*)::int AS n,
     count(*) FILTER (WHERE client_id IS NULL)::int AS client_id_null,
     count(*) FILTER (WHERE client_id IS NOT NULL)::int AS client_id_set,
     count(*) FILTER (WHERE client_id = $1)::int AS this_file,
     count(*) FILTER (WHERE client_id = $2)::int AS forbidden,
     count(*) FILTER (WHERE client_id = $3)::int AS compare
   FROM events
   WHERE name IN ('payment.received', 'diagnostic.paid')`,
  [THIS, FORBIDDEN, COMPARE]
)).rows[0];

const liveIds = [
  "629d54f6-1ee3-4b04-9903-9ec984f1a9ff",
  "98368a84-6465-4d07-86ff-4c5ef3212b88",
  "25b466ee-19b0-4043-9c90-333349603d8d",
  "c9751f20-eb44-463d-b2fe-baab41fa0d68",
  "472f73eb-5c03-470e-8216-8f6f6f610e1b",
  "3aa60eab-ea05-4776-86fb-a6dae5c1cdfb",
  "a82c4092-be7c-42ce-8d12-4ec836827e70"
];

const liveEmailShape = (await db.query(
  `SELECT e.id, e.name, e.client_id, e.org_id,
          (e.payload ? 'email') AS has_email_key,
          length(btrim(coalesce(e.payload->>'email', ''))) AS email_len,
          position('@' in coalesce(e.payload->>'email', '')) > 0 AS email_has_at,
          lower(btrim(e.payload->>'email')) = lower((SELECT email FROM clients WHERE id = $2)) AS email_eq_this_file,
          lower(btrim(e.payload->>'email')) = lower((SELECT email FROM clients WHERE id = $3)) AS email_eq_compare,
          lower(btrim(e.payload->>'email')) = lower((SELECT email FROM clients WHERE id = $4)) AS email_eq_forbidden,
          EXISTS (
            SELECT 1 FROM clients c
             WHERE c.org_id = e.org_id
               AND c.email IS NOT NULL
               AND lower(c.email) = lower(btrim(e.payload->>'email'))
          ) AS email_matches_any_client_in_org
     FROM events e
    WHERE e.id = ANY($1::uuid[])
    ORDER BY e.created_at`,
  [liveIds, THIS, COMPARE, FORBIDDEN]
)).rows;

const stages = (await db.query(
  `SELECT ps.key, ps.name, ps.sort_order
     FROM pipeline_stages ps
     JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE p.org_id = $1 AND p.key = 'sales'
      AND ps.key IN ('diagnostic_paid', 'decision_rendered', 'new_lead', 'survey_complete')
    ORDER BY ps.sort_order`,
  [ORG]
)).rows;

const afterTx = (await db.query(
  `SELECT id, provider_ref, client_id, amount_paid, status
     FROM transactions
    WHERE client_id = $1
    ORDER BY created_at`,
  [THIS]
)).rows;

fs.writeFileSync(path.join(OUT, "live-email-shape.json"), JSON.stringify({
  note: "No email values printed. W10 said live payment events have no email. This checks that claim.",
  db_user: who,
  event_visibility: eventVisibility,
  live_w10_ids: liveEmailShape,
  sales_stage_sort: stages,
  this_file_transactions: afterTx
}, null, 2));

await close();

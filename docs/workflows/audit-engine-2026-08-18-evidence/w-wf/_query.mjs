// Read-only events dump for W-WF. Writes JSON only. Never prints secrets or emails.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../../..");
const CLIENT = "41a3199f-1835-4ac8-91c0-d4f37bd92037";
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const EMAIL = "sim+1787079946953@demo.fundhub.local";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const PAY_NULL_IDS = [
  "ee763f7f-3aef-49a9-a308-0f69ca835934",
  "0bc264a3-e1dc-42d0-ae87-18b96a4a7ad4",
];
const PAY_THIS_IDS = [
  "09889e94-8f08-40d2-8312-6616157bfa7f",
  "81695ac8-f9ae-4a6f-b8fa-2c2044371c37",
];
const ALL_PAY_IDS = [...PAY_NULL_IDS, ...PAY_THIS_IDS];

function loadEnvFile(name) {
  const out = {};
  let raw = "";
  try {
    raw = readFileSync(join(root, name), "utf8");
  } catch {
    return { exists: false, names: [], values: out };
  }
  const names = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    names.push(m[1]);
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return { exists: true, names, values: out };
}

const envFile = loadEnvFile(".env");
if (envFile.values.DATABASE_URL) process.env.DATABASE_URL = envFile.values.DATABASE_URL;

const inngest = {
  name: "INNGEST_EVENT_KEY",
  in_dotenv: envFile.names.includes("INNGEST_EVENT_KEY"),
  dotenv_nonempty: Boolean(envFile.values.INNGEST_EVENT_KEY),
  in_process: Boolean(process.env.INNGEST_EVENT_KEY),
};

if (!process.env.DATABASE_URL) {
  writeFileSync(join(here, "_db.json"), JSON.stringify({ error: "DATABASE_URL missing", inngest }, null, 2));
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

function rowShape(r) {
  return {
    id: r.id,
    name: r.name,
    client_id: r.client_id,
    org_id: r.org_id,
    idempotency_key: r.idempotency_key,
    created_at: r.created_at,
    is_demo: r.is_demo ?? null,
    payload_keys: r.payload_keys,
    payload_has_clientId: r.payload_has_clientid,
    payload_clientId_is_this_file: r.payload_clientid_is_this,
    payload_has_email: r.payload_has_email,
    payload_email_is_this_file: r.payload_email_is_this,
    client_id_is_this_file: r.client_id === CLIENT,
    client_id_is_forbidden: r.client_id === FORBIDDEN,
  };
}

const selectShape = `
  id, name, client_id, org_id, idempotency_key, created_at,
  (SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
     FROM jsonb_object_keys(COALESCE(payload, '{}'::jsonb)) AS k) AS payload_keys,
  (payload ? 'clientId') AS payload_has_clientid,
  ((payload->>'clientId') = $1) AS payload_clientid_is_this,
  (payload ? 'email') AS payload_has_email,
  (lower(payload->>'email') = lower($2)) AS payload_email_is_this
`;

const byClient = await db.query(
  `SELECT ${selectShape}
     FROM events
    WHERE client_id = $3::uuid
    ORDER BY created_at ASC`,
  [CLIENT, EMAIL, CLIENT]
);

const payById = await db.query(
  `SELECT ${selectShape}
     FROM events
    WHERE id = ANY($3::uuid[])
    ORDER BY created_at ASC`,
  [CLIENT, EMAIL, ALL_PAY_IDS]
);

const nullClaimed = await db.query(
  `SELECT ${selectShape}
     FROM events
    WHERE client_id IS NULL
      AND org_id = $3::uuid
      AND (
        lower(payload->>'email') = lower($2)
        OR payload->>'clientId' = $1
        OR payload->>'client_id' = $1
      )
    ORDER BY created_at ASC`,
  [CLIENT, EMAIL, ORG]
);

let failed = { rows: [], error: null };
try {
  failed = await db.query(
    `SELECT id, event_id, event_name, handler_name, status, created_at, client_id
       FROM failed_events
      WHERE client_id = $1
         OR event_id = ANY($2::uuid[])
      ORDER BY created_at ASC`,
    [CLIENT, [...byClient.rows.map((r) => r.id), ...ALL_PAY_IDS]]
  );
} catch (err) {
  failed = { rows: [], error: err.code || "query_failed" };
}

const tasks = await db.query(
  `SELECT id, title, source_workflow, created_at
     FROM tasks
    WHERE client_id = $1
    ORDER BY created_at ASC`,
  [CLIENT]
);

const clientRow = await db.query(
  `SELECT id, custom_fields, updated_at
     FROM clients
    WHERE id = $1`,
  [CLIENT]
);

const tx = await db.query(
  `SELECT id, amount_paid, product_name, created_at
     FROM transactions
    WHERE client_id = $1
    ORDER BY created_at ASC`,
  [CLIENT]
);

let tags = [];
try {
  const tagRows = await db.query(
    `SELECT tag FROM client_tags WHERE client_id = $1`,
    [CLIENT]
  );
  tags = tagRows.rows.map((r) => r.tag);
} catch {
  try {
    const tagRows = await db.query(
      `SELECT unnest(tags) AS tag FROM clients WHERE id = $1`,
      [CLIENT]
    );
    tags = tagRows.rows.map((r) => r.tag);
  } catch {
    tags = [];
  }
}

const sales = await db.query(
  `SELECT id, created_at FROM sales WHERE client_id = $1`,
  [CLIENT]
);

let isDemoCol = false;
try {
  const col = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='events' AND column_name='is_demo'`
  );
  isDemoCol = col.rows.length > 0;
} catch {
  isDemoCol = false;
}

await db.end();

const cf = clientRow.rows[0]?.custom_fields || {};
const out = {
  queried_at: new Date().toISOString(),
  client_id: CLIENT,
  org_id: ORG,
  inngest_key: inngest,
  events_has_is_demo: isDemoCol,
  events_this_client: byClient.rows.map(rowShape),
  events_pay_ids: payById.rows.map(rowShape),
  events_null_client_this_email_or_payload_id: nullClaimed.rows.map(rowShape),
  failed_events: failed.rows,
  failed_events_error: failed.error || null,
  tasks: tasks.rows,
  transactions: tx.rows,
  sales: sales.rows,
  client: {
    tags,
    custom_field_keys: Object.keys(cf).sort(),
    has_crs_paid: cf.crs_paid === true,
    has_path_funding_tag: tags.includes("path:funding"),
    last_progress_action: cf.last_progress_action ?? null,
    affiliate_tier1_owner: cf.affiliate_tier1_owner ?? null,
    analyzer_path: cf.analyzer_path ?? null,
    updated_at: clientRow.rows[0]?.updated_at ?? null,
  },
};

writeFileSync(join(here, "_db.json"), JSON.stringify(out, null, 2));
console.log("wrote _db.json", {
  this_client: byClient.rows.length,
  pay_ids: payById.rows.length,
  null_claimed: nullClaimed.rows.length,
  failed: failed.rows.length,
  tasks: tasks.rows.length,
});

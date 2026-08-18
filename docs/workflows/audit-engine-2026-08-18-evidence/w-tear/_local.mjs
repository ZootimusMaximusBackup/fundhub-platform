// Local teardown of THIS simulated client only, after live DELETE 504.
// Records designed-function result, then extra deletes the product path skips.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { teardownSimulated } from "../../../../src/demo/simulate-client.mjs";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-tear");
const SHARED = JSON.parse(fs.readFileSync(
  path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/SHARED.json"),
  "utf8"
));
const CLIENT = SHARED.client_id;
const ORG = SHARED.org_id;
const FORBIDDEN = SHARED.forbidden_live;

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

const pool = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const extras = [
  "contract_signers",
  "contracts",
  "client_consents",
  "documents",
  "inquiry_removal_cases",
  "events",
  "sales",
  "sale_payments",
  "bank_inbox",
  "messages",
  "tasks",
  "cards"
];

async function countClient(c) {
  const r = await c.query(`SELECT id, is_demo FROM clients WHERE id = $1`, [CLIENT]);
  return r.rows;
}

async function counts(c) {
  const tables = (await c.query(`
    SELECT table_name FROM information_schema.columns
     WHERE table_schema='public' AND column_name='client_id'
       AND table_name NOT LIKE 'v_%'
     ORDER BY 1
  `)).rows.map((x) => x.table_name);
  const out = {};
  for (const t of tables) {
    try {
      const r = await c.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE client_id = $1`, [CLIENT]);
      if (r.rows[0].n) out[t] = r.rows[0].n;
    } catch { /* skip */ }
  }
  return out;
}

async function main() {
  if (CLIENT === FORBIDDEN) throw new Error("refuse forbidden");
  await pool.connect();
  const demo = await countClient(pool);
  if (!demo.length || demo[0].is_demo !== true) {
    throw new Error("refusing: client missing or not is_demo");
  }

  let designed = null;
  try {
    designed = await teardownSimulated(pool, { orgId: ORG, clientId: CLIENT });
  } catch (e) {
    designed = { error: String(e.message || e) };
  }
  const afterDesigned = {
    client: await countClient(pool),
    tables: await counts(pool)
  };
  fs.writeFileSync(path.join(OUT, "local-designed.json"), JSON.stringify({
    designed, afterDesigned
  }, null, 2));

  const extraResults = [];
  if (afterDesigned.client.length) {
    for (const t of extras) {
      try {
        const r = await pool.query(`DELETE FROM ${t} WHERE client_id = $1 RETURNING id`, [CLIENT]);
        extraResults.push({ table: t, deleted: r.rowCount });
      } catch (e) {
        extraResults.push({ table: t, error: String(e.message || e) });
      }
    }
    try {
      designed = await teardownSimulated(pool, { orgId: ORG, clientId: CLIENT });
    } catch (e) {
      extraResults.push({ table: "teardownSimulated-retry", error: String(e.message || e) });
    }
  }

  const finalClient = await countClient(pool);
  const finalTables = await counts(pool);
  const forbidden = (await pool.query(`SELECT id FROM clients WHERE id = $1`, [FORBIDDEN])).rows.length;
  await pool.end();

  const out = {
    extraResults,
    client_gone: finalClient.length === 0,
    leftover: finalTables,
    forbidden_still: forbidden
  };
  fs.writeFileSync(path.join(OUT, "local-cleanup.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});

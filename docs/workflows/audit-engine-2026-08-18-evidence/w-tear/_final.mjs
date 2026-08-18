import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-tear");
const CLIENT = "41a3199f-1835-4ac8-91c0-d4f37bd92037";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const COMPARE = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const KNOWN = [
  ["clients", CLIENT],
  ["inquiry_removal_cases", "d1635579-eda9-4961-8ca8-50abe7151ecf"],
  ["documents", "bf55375a-b4c7-48aa-8241-9b818bc60c82"],
  ["documents", "864fd394-7ba8-43e3-b7c5-77befaa51540"],
  ["documents", "9e11d5b1-47c2-4ea7-bebc-a59de2927c6e"],
  ["client_consents", "7057e732-9411-4512-98b9-23a7a1fe7d77"],
  ["contracts", "82f9232a-3c6d-4cd5-85eb-b4995e4f539a"],
  ["sales", "75429aa0-2105-4e4d-858a-1b57b605f4ed"]
];

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

async function main() {
  const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await c.connect();
  const tables = (await c.query(`
    SELECT table_name FROM information_schema.columns
     WHERE table_schema='public' AND column_name='client_id'
       AND table_name NOT LIKE 'v_%'
  `)).rows.map((r) => r.table_name);
  const leftover = {};
  for (const t of tables) {
    try {
      const r = await c.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE client_id = $1`, [CLIENT]);
      if (r.rows[0].n) leftover[t] = r.rows[0].n;
    } catch { /* skip */ }
  }
  const known = {};
  for (const [t, id] of KNOWN) {
    try {
      const r = await c.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE id = $1`, [id]);
      known[t + ":" + id] = r.rows[0].n;
    } catch (e) {
      known[t + ":" + id] = String(e.message || e);
    }
  }
  const others = {
    forbidden: (await c.query(`SELECT COUNT(*)::int AS n FROM clients WHERE id=$1`, [FORBIDDEN])).rows[0].n,
    compare: (await c.query(`SELECT COUNT(*)::int AS n FROM clients WHERE id=$1`, [COMPARE])).rows[0].n
  };
  await c.end();
  const out = { leftover, known, others };
  fs.writeFileSync(path.join(OUT, "final.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e.message); process.exit(1); });

// Migrations runner (Spec §16 Phase 0). Applies db/schema/*.sql then db/seed/*.sql
// in filename order, tracking applied files in a schema_migrations table so it's
// idempotent + safe to re-run. Each file runs in its own transaction.
//
// Usage: DATABASE_URL=postgres://... node db/migrate.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, close } from "../src/db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIRS = ["schema", "seed"];

function collect() {
  const files = [];
  for (const d of DIRS) {
    const dir = path.join(HERE, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      files.push({ key: `${d}/${f}`, path: path.join(dir, f) });
    }
  }
  return files;
}

async function main() {
  const p = pool();
  await p.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    key text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const applied = new Set((await p.query(`SELECT key FROM schema_migrations`)).rows.map((r) => r.key));

  let ran = 0;
  for (const f of collect()) {
    if (applied.has(f.key)) { console.log(`· skip ${f.key} (already applied)`); continue; }
    const sql = fs.readFileSync(f.path, "utf8");
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (key) VALUES ($1)`, [f.key]);
      await client.query("COMMIT");
      console.log(`✔ applied ${f.key}`);
      ran += 1;
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`✗ FAILED ${f.key}: ${e.message}`);
      throw e;
    } finally {
      client.release();
    }
  }
  console.log(`\nDone. ${ran} migration(s) applied.`);
  await close();
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });

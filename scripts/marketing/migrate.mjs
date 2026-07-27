#!/usr/bin/env node
// Applies db/migrations/*.sql — the marketing warehouse migrations.
//
//   DATABASE_URL=postgres://… node scripts/marketing/migrate.mjs
//
// ── WHY THIS EXISTS (and when it should go away) ───────────────────────────
// The platform runner db/migrate.mjs scans exactly two directories:
//
//     const DIRS = ["schema", "seed"];
//
// db/migrations is not one of them, so 022_marketing_warehouse.sql would never
// be applied by `npm run migrate`. The fix is a one-word change to that array
// — but db/migrate.mjs is outside this workstream's ownership, so rather than
// reach into a file another builder owns, this runner covers the gap.
//
// It is deliberately INTEROPERABLE, not parallel: same schema_migrations
// table, same "dir/file" key format, same one-transaction-per-file rule. So
// when whoever owns db/migrate.mjs adds "migrations" to DIRS, that runner sees
// key 'migrations/022_marketing_warehouse.sql' already applied and skips it.
// No double-apply, no cleanup, and this file can simply be deleted.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, close } from "../../src/db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, "../../db/migrations");

async function main() {
  if (!fs.existsSync(DIR)) {
    console.error(`no migrations directory at ${DIR}`);
    return;
  }

  const p = pool();
  await p.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    key text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const applied = new Set(
    (await p.query(`SELECT key FROM schema_migrations`)).rows.map((r) => r.key)
  );

  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  let ran = 0;

  for (const f of files) {
    const key = `migrations/${f}`;
    if (applied.has(key)) { console.log(`· skip ${key} (already applied)`); continue; }

    const sql = fs.readFileSync(path.join(DIR, f), "utf8");
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (key) VALUES ($1)`, [key]);
      await client.query("COMMIT");
      console.log(`✔ applied ${key}`);
      ran += 1;
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`✗ FAILED ${key}: ${e.message}`);
      throw e;
    } finally {
      client.release();
    }
  }

  console.log(`\nDone. ${ran} migration(s) applied.`);
  await close();
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });

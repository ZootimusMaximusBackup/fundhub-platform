// Migrations runner (Spec §16 Phase 0). Applies db/schema/*.sql then db/seed/*.sql
// in filename order, tracking applied files in a schema_migrations table so it's
// idempotent + safe to re-run. Each file runs in its own transaction.
//
// Usage: MIGRATION_DATABASE_URL=postgres://... node db/migrate.mjs
//    or: DATABASE_URL=postgres://... node db/migrate.mjs   (see below)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, close } from "../src/db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIRS = ["schema", "migrations", "seed"];

/* WHICH CONNECTION MIGRATIONS USE, AND WHY IT IS NO LONGER DATABASE_URL.

   104_app_role.sql splits one connection string into two identities. The app
   runs as `fundhub_app`, which holds SELECT/INSERT/UPDATE/DELETE and nothing
   else — deliberately no CREATE on the schema, because a web request has no
   business reshaping tables. Migrations do exactly that, so they cannot run as
   the app.

   Without this preference, the first migration written after the switch fails
   with a permission error, and it fails at the least convenient moment: after
   the deploy, when someone is trying to ship. So the runner asks for the admin
   connection by name.

   The fallback to DATABASE_URL is what keeps every existing habit working —
   a local scratch database, a fresh clone, and the command in CLAUDE.md §11 all
   still run unchanged. This is a preference, not a requirement.

   Set before pool() is ever called. src/db.mjs reads process.env.DATABASE_URL
   lazily on first use, not at import time, so assigning here is what the pool
   picks up. */
const ADMIN_URL = process.env.MIGRATION_DATABASE_URL;
if (ADMIN_URL) {
  process.env.DATABASE_URL = ADMIN_URL;
  console.log("→ connecting with MIGRATION_DATABASE_URL (admin/owner identity)");
} else if (process.env.DATABASE_URL) {
  console.log("→ MIGRATION_DATABASE_URL not set; falling back to DATABASE_URL");
  console.log("  If that is now the restricted app role, migrations creating or");
  console.log("  altering tables will fail with a permission error. See");
  console.log("  docs/runbooks/postgres-least-privilege.md");
}
// Never log either value — both are credentials (CLAUDE.md §11).

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
    // Postgres NOTICE messages (RAISE NOTICE inside a migration's own DO
    // blocks — 090/104/105 all use this to report what they verified) were
    // never surfaced anywhere: node-postgres emits them as a 'notice' event
    // on the client, and nothing here was listening. A migration could report
    // success on stdout while its own RAISE NOTICE, containing the actual
    // finding, went straight to /dev/null. Print it, prefixed so it reads as
    // coming from inside the file rather than from this runner.
    client.on("notice", (msg) => console.log(`  [${f.key}] ${msg.message}`));
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

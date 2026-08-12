#!/usr/bin/env node
// One-shot: apply migrations/162_commas_inbox_no_bare_rls.sql only.
// Does NOT run pending 160/161. NEVER logs DATABASE_URL. Delete after use.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "";
if (!url) {
  console.error("FAIL: MIGRATION_DATABASE_URL/DATABASE_URL missing");
  process.exit(1);
}
if (url.includes("****") || /^[*]+$/.test(url.replace(/\s/g, "")) || /@base(\/|:|$)/.test(url)) {
  console.error("FAIL: database URL looks masked or host=base");
  process.exit(1);
}
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error("FAIL: database URL is not a postgres URL shape");
  process.exit(1);
}
console.log(
  "USING",
  process.env.MIGRATION_DATABASE_URL ? "MIGRATION_DATABASE_URL" : "DATABASE_URL"
);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(HERE, "../db/migrations/162_commas_inbox_no_bare_rls.sql");
const key = "migrations/162_commas_inbox_no_bare_rls.sql";

const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 15000,
  statement_timeout: 30000
});

try {
  await client.connect();
  await client.query("SELECT 1 AS ok");
  console.log("PING: ok");

  const pending = await client.query(
    `SELECT key FROM (VALUES
       ('migrations/160_metro2_dispute_engine.sql'),
       ('migrations/161_optimization_repair_pipeline.sql')
     ) v(key)
     WHERE NOT EXISTS (SELECT 1 FROM schema_migrations sm WHERE sm.key = v.key)`
  );
  console.log("PENDING_160_161", pending.rowCount, "(left untouched)");

  const already = await client.query("SELECT 1 FROM schema_migrations WHERE key=$1", [key]);
  if (already.rowCount) {
    console.log("162_ALREADY_APPLIED");
  } else {
    const sql = fs.readFileSync(sqlPath, "utf8");
    client.on("notice", (n) => console.log("NOTICE", n.message));
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (key) VALUES ($1)", [key]);
      await client.query("COMMIT");
      console.log("162_APPLIED");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }

  const pol = await client.query(
    `SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='commas_inbox'`
  );
  const rls = await client.query(
    `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='commas_inbox'`
  );
  console.log("COMMAS_INBOX_RLS", JSON.stringify(rls.rows[0] || null));
  console.log("COMMAS_INBOX_POLICIES", JSON.stringify(pol.rows.map((r) => r.policyname)));
  if ((pol.rows || []).length === 0 && rls.rows[0]?.rls === true) {
    console.error("FAIL: still bare RLS");
    process.exit(2);
  }
  console.log("APPLY_162_OK");
} catch (err) {
  console.error("FAIL:", err && err.message ? err.message : String(err));
  process.exit(1);
} finally {
  try {
    await client.end();
  } catch {
    /* ignore */
  }
}

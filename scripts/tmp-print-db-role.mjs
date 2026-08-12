#!/usr/bin/env node
/** Write DB role privilege snapshot to public/ (no secrets). Always exit 0. */
import fs from "node:fs";
import pg from "pg";

const out = [];
const log = (s) => out.push(String(s));

log(`at ${new Date().toISOString()}`);
for (const k of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
  const v = process.env[k] || "";
  log(`${k}_set ${Boolean(v)}`);
  if (!v) continue;
  try {
    const u = new URL(v.replace(/^postgres(ql)?:/i, "http:"));
    log(`${k}_host ${u.hostname}`);
    log(`${k}_user ${u.username}`);
    log(`${k}_db ${u.pathname.replace(/^\//, "")}`);
    log(
      `${k}_provider ${/supabase/i.test(u.hostname) ? "supabase" : /neon/i.test(u.hostname) ? "neon" : "other"}`
    );
  } catch (e) {
    log(`${k}_parse_fail ${String(e.message || e).slice(0, 80)}`);
  }
}

const url = process.env.DATABASE_URL || "";
if (url && !url.includes("****") && !/@base(\/|:|$)/.test(url)) {
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000
  });
  try {
    await client.connect();
    const r = await client.query(`
      WITH reachable AS (
        SELECT r.* FROM pg_roles r WHERE pg_has_role(current_user, r.oid, 'MEMBER')
      )
      SELECT
        current_user::text AS role_name,
        current_database()::text AS db_name,
        current_setting('is_superuser') AS is_superuser_setting,
        (SELECT count(*) FROM reachable WHERE rolsuper) AS n_super,
        (SELECT count(*) FROM reachable WHERE rolbypassrls) AS n_bypassrls,
        (SELECT count(*) FROM reachable WHERE rolcreatedb) AS n_createdb,
        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public
    `);
    log(`DATABASE_URL_role ${JSON.stringify(r.rows[0])}`);
  } catch (e) {
    log(`DATABASE_URL_query_fail ${String(e.message || e).slice(0, 200)}`);
  } finally {
    await client.end().catch(() => {});
  }
} else {
  log("DATABASE_URL_unusable_or_masked");
}

const mig = process.env.MIGRATION_DATABASE_URL || "";
if (mig && !mig.includes("****") && !/@base(\/|:|$)/.test(mig)) {
  const client = new pg.Client({
    connectionString: mig,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000
  });
  try {
    await client.connect();
    const r = await client.query(`
      SELECT current_user::text AS role_name,
             current_setting('is_superuser') AS is_superuser_setting
    `);
    log(`MIGRATION_URL_role ${JSON.stringify(r.rows[0])}`);
  } catch (e) {
    log(`MIGRATION_URL_query_fail ${String(e.message || e).slice(0, 200)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

fs.mkdirSync("public", { recursive: true });
fs.writeFileSync("public/w4a-db-role.txt", out.join("\n") + "\n");
console.log("WROTE public/w4a-db-role.txt lines", out.length);
process.exit(0);

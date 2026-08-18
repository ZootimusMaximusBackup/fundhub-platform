// W11 read-only catalog dump. Never prints DATABASE_URL or row PII.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../../");
const OUT = HERE;

function readEnvKey(key) {
  const text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const re = new RegExp(`^${key}=(.*)$`, "m");
  const m = text.match(re);
  if (!m) throw new Error(`${key} missing from .env`);
  let v = m[1];
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    v = v.slice(1, -1);
  }
  return v;
}

function urlMeta(connectionString) {
  const u = new URL(connectionString);
  const user = decodeURIComponent(u.username || "");
  const roleGuess = user.split(".")[0] || user;
  const host = u.hostname || "";
  let via = "other";
  if (host.includes("pooler")) via = "supabase_pooler";
  else if (host.includes("supabase")) via = "supabase_direct";
  return {
    username_role: roleGuess,
    username_has_project_suffix: user.includes("."),
    via,
    db_name: (u.pathname || "").replace(/^\//, "") || null,
    port: u.port || null
  };
}

const connectionString = readEnvKey("DATABASE_URL");
const meta = urlMeta(connectionString);

const client = new pg.Client({
  connectionString,
  connectionTimeoutMillis: 10000,
  statement_timeout: 120000,
  ssl: { rejectUnauthorized: false }
});

await client.connect();

const identity = await client.query(`
  SELECT
    current_user AS current_user,
    session_user AS session_user,
    current_database() AS current_database,
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS current_rolsuper,
    (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS current_rolbypassrls,
    (SELECT rolcanlogin FROM pg_roles WHERE rolname = current_user) AS current_rolcanlogin,
    (SELECT rolsuper FROM pg_roles WHERE rolname = 'fundhub_app') AS fundhub_app_rolsuper,
    (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'fundhub_app') AS fundhub_app_rolbypassrls,
    (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'fundhub_app') AS fundhub_app_rolcanlogin,
    (SELECT rolsuper FROM pg_roles WHERE rolname = 'postgres') AS postgres_rolsuper,
    (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'postgres') AS postgres_rolbypassrls
`);

const schemas = await client.query(`
  SELECT schema_name
    FROM information_schema.schemata
   WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
     AND schema_name NOT LIKE 'pg_temp_%'
     AND schema_name NOT LIKE 'pg_toast_temp_%'
   ORDER BY schema_name
`);

const tables = await client.query(`
  SELECT n.nspname AS schema,
         c.relname AS name,
         c.relkind,
         c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS rls_forced,
         pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'v', 'm')
   ORDER BY c.relkind, c.relname
`);

function quoteIdent(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`refusing to count non-simple table name: ${name}`);
  }
  return `"${name}"`;
}

const counts = [];
for (const t of tables.rows.filter((r) => r.relkind === "r" || r.relkind === "p")) {
  const r = await client.query(`SELECT count(*)::bigint AS n FROM ${quoteIdent(t.name)}`);
  counts.push({ table: t.name, row_count: Number(r.rows[0].n) });
}

const columns = await client.query(`
  SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
   WHERE table_schema = 'public'
   ORDER BY table_name, ordinal_position
`);

const policies = await client.query(`
  SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
   WHERE schemaname = 'public'
   ORDER BY tablename, policyname
`);

const fks = await client.query(`
  SELECT
    tc.table_name AS child_table,
    kcu.column_name AS child_column,
    ccu.table_name AS parent_table,
    ccu.column_name AS parent_column,
    rc.delete_rule,
    rc.update_rule,
    tc.constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
   AND ccu.table_schema = tc.table_schema
  JOIN information_schema.referential_constraints rc
    ON rc.constraint_name = tc.constraint_name
   AND rc.constraint_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
  ORDER BY tc.table_name, kcu.ordinal_position
`);

const clientIdCols = await client.query(`
  SELECT table_name, column_name
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND column_name IN (
       'client_id', 'contact_id', 'contract_id', 'document_id',
       'staff_id', 'org_id', 'partner_id', 'account_id'
     )
   ORDER BY table_name, column_name
`);

const migrations = await client.query(`
  SELECT key, applied_at
    FROM schema_migrations
   ORDER BY applied_at, key
`);

const confirm170171 = await client.query(`
  SELECT
    (SELECT applied_at FROM schema_migrations WHERE key = 'migrations/170_call_outcome_checklist.sql') AS m170_applied_at,
    (SELECT applied_at FROM schema_migrations WHERE key = 'migrations/171_content.sql') AS m171_applied_at,
    EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'call_outcomes' AND column_name = 'checklist'
    ) AS call_outcomes_checklist_exists,
    (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'call_outcomes' AND column_name = 'checklist') AS checklist_type,
    EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'entitlement_catalog' AND column_name = 'display_price_cents'
    ) AS entitlement_catalog_display_price_cents_exists,
    (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'entitlement_catalog' AND column_name = 'display_price_cents') AS display_price_type,
    EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'content_videos'
    ) AS content_videos_exists,
    EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'content_tier_map'
    ) AS content_tier_map_exists
`);

const piiCols = await client.query(`
  SELECT table_name, column_name, data_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND (
       column_name ~* '(email|phone|ssn|ein|dob|birth|address|street|city|zip|postal|first_name|last_name|full_name|legal_name|ssn_last|itin|license|passport|ip_address|bank_account|routing|account_number|card_number|pan)'
       OR column_name IN ('name', 'mobile', 'ssn_enc', 'pii', 'payload')
     )
   ORDER BY table_name, column_name
`);

function write(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2) + "\n");
}

write("identity.json", {
  queried_at: new Date().toISOString(),
  database_url_meta: meta,
  session: identity.rows[0],
  note: "DATABASE_URL itself is not written. username_role is the login role prefix only."
});
write("schemas.json", schemas.rows.map((r) => r.schema_name));
write("tables.json", tables.rows);
write("row_counts.json", counts);
write("columns.json", columns.rows);
write("rls_policies.json", policies.rows);
write("foreign_keys.json", fks.rows);
write("id_columns.json", clientIdCols.rows);
write("schema_migrations.json", migrations.rows);
write("confirm_170_171.json", confirm170171.rows[0]);
write("pii_column_names.json", piiCols.rows);

await client.end();
console.log(JSON.stringify({
  ok: true,
  tables: tables.rows.length,
  counts: counts.length,
  policies: policies.rows.length,
  migrations: migrations.rows.length,
  role: identity.rows[0].current_user,
  super: identity.rows[0].current_rolsuper
}));

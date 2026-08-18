// W11 read-only: orphan counts only. No PII values.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../../");

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

function ident(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`unsafe ident: ${name}`);
  }
  return `"${name}"`;
}

const client = new pg.Client({
  connectionString: readEnvKey("DATABASE_URL"),
  connectionTimeoutMillis: 10000,
  statement_timeout: 180000,
  ssl: { rejectUnauthorized: false }
});
await client.connect();

const namespaces = await client.query(`
  SELECT nspname
    FROM pg_namespace
   WHERE nspname NOT LIKE 'pg_toast%'
     AND nspname NOT LIKE 'pg_temp_%'
     AND nspname NOT LIKE 'pg_toast_temp_%'
   ORDER BY nspname
`);

const roles = await client.query(`
  SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole
    FROM pg_roles
   WHERE rolname NOT LIKE 'pg_%'
   ORDER BY rolname
`);

const rlsGaps = await client.query(`
  SELECT c.relname AS table_name,
         c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS rls_forced,
         EXISTS (
           SELECT 1 FROM pg_policies p
            WHERE p.schemaname = 'public' AND p.tablename = c.relname
         ) AS has_policy
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
   ORDER BY c.relname
`);

const views = await client.query(`
  SELECT table_name
    FROM information_schema.views
   WHERE table_schema = 'public'
   ORDER BY table_name
`);

const fks = JSON.parse(fs.readFileSync(path.join(HERE, "foreign_keys.json"), "utf8"));
const idCols = JSON.parse(fs.readFileSync(path.join(HERE, "id_columns.json"), "utf8"));

const fkPairs = [];
const seenFk = new Set();
for (const fk of fks) {
  const key = `${fk.child_table}.${fk.child_column}->${fk.parent_table}.${fk.parent_column}`;
  if (seenFk.has(key)) continue;
  seenFk.add(key);
  fkPairs.push(fk);
}

const fkOrphans = [];
for (const fk of fkPairs) {
  const sql = `
    SELECT count(*)::bigint AS n
      FROM ${ident(fk.child_table)} c
      LEFT JOIN ${ident(fk.parent_table)} p
        ON c.${ident(fk.child_column)} = p.${ident(fk.parent_column)}
     WHERE c.${ident(fk.child_column)} IS NOT NULL
       AND p.${ident(fk.parent_column)} IS NULL
  `;
  try {
    const r = await client.query(sql);
    const n = Number(r.rows[0].n);
    if (n > 0) {
      fkOrphans.push({
        child_table: fk.child_table,
        child_column: fk.child_column,
        parent_table: fk.parent_table,
        parent_column: fk.parent_column,
        delete_rule: fk.delete_rule,
        orphan_count: n,
        kind: "fk_violation_or_missing_parent"
      });
    }
  } catch (e) {
    fkOrphans.push({
      child_table: fk.child_table,
      child_column: fk.child_column,
      parent_table: fk.parent_table,
      error: e.message,
      kind: "query_failed"
    });
  }
}

const setNullLeft = [];
for (const fk of fkPairs.filter((f) => f.delete_rule === "SET NULL")) {
  const sql = `
    SELECT count(*)::bigint AS n
      FROM ${ident(fk.child_table)}
     WHERE ${ident(fk.child_column)} IS NULL
  `;
  try {
    const r = await client.query(sql);
    const n = Number(r.rows[0].n);
    if (n > 0) {
      setNullLeft.push({
        child_table: fk.child_table,
        child_column: fk.child_column,
        parent_table: fk.parent_table,
        delete_rule: "SET NULL",
        null_count: n,
        note: "NULL parent pointer. Could be never-set or leftover after ON DELETE SET NULL. Count only."
      });
    }
  } catch (e) {
    setNullLeft.push({ child_table: fk.child_table, error: e.message });
  }
}

const fkCover = new Set(fkPairs.map((f) => `${f.child_table}.${f.child_column}`));
const danglingId = [];
const parentGuess = {
  client_id: ["clients", "id"],
  contact_id: ["contacts", "id"],
  contract_id: ["contracts", "id"],
  document_id: ["documents", "id"],
  staff_id: ["staff", "id"],
  org_id: ["orgs", "id"],
  partner_id: ["partners", "id"],
  account_id: ["accounts", "id"]
};

const liveTables = new Set(
  JSON.parse(fs.readFileSync(path.join(HERE, "row_counts.json"), "utf8")).map((r) => r.table)
);

for (const col of idCols) {
  const key = `${col.table_name}.${col.column_name}`;
  if (fkCover.has(key)) continue;
  const guess = parentGuess[col.column_name];
  if (!guess) continue;
  const [parent, parentCol] = guess;
  if (!liveTables.has(parent) || !liveTables.has(col.table_name)) {
    danglingId.push({
      child_table: col.table_name,
      child_column: col.column_name,
      guessed_parent: parent,
      skipped: "parent_or_child_table_missing",
      has_fk: false
    });
    continue;
  }
  const sql = `
    SELECT count(*)::bigint AS n
      FROM ${ident(col.table_name)} c
      LEFT JOIN ${ident(parent)} p
        ON c.${ident(col.column_name)} = p.${ident(parentCol)}
     WHERE c.${ident(col.column_name)} IS NOT NULL
       AND p.${ident(parentCol)} IS NULL
  `;
  try {
    const r = await client.query(sql);
    const n = Number(r.rows[0].n);
    danglingId.push({
      child_table: col.table_name,
      child_column: col.column_name,
      guessed_parent: parent,
      has_fk: false,
      orphan_count: n
    });
  } catch (e) {
    danglingId.push({
      child_table: col.table_name,
      child_column: col.column_name,
      guessed_parent: parent,
      has_fk: false,
      error: e.message
    });
  }
}

const clientIdNoFk = danglingId.filter((r) => r.child_column === "client_id");

fs.writeFileSync(path.join(HERE, "namespaces.json"), JSON.stringify(namespaces.rows.map((r) => r.nspname), null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "roles.json"), JSON.stringify(roles.rows, null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "rls_coverage.json"), JSON.stringify(rlsGaps.rows, null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "views.json"), JSON.stringify(views.rows.map((r) => r.table_name), null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "orphans_fk.json"), JSON.stringify(fkOrphans, null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "orphans_set_null.json"), JSON.stringify(setNullLeft, null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "orphans_no_fk.json"), JSON.stringify(danglingId, null, 2) + "\n");

const summary = {
  namespaces: namespaces.rows.map((r) => r.nspname),
  role_count: roles.rows.length,
  tables_no_rls: rlsGaps.rows.filter((r) => !r.rls_enabled).map((r) => r.table_name),
  tables_rls_no_policy: rlsGaps.rows.filter((r) => r.rls_enabled && !r.has_policy).map((r) => r.table_name),
  view_count: views.rows.length,
  fk_orphan_pairs: fkOrphans.length,
  fk_orphan_rows: fkOrphans.reduce((s, r) => s + (r.orphan_count || 0), 0),
  client_id_no_fk_orphans: clientIdNoFk.filter((r) => r.orphan_count > 0)
};
fs.writeFileSync(path.join(HERE, "orphan_summary.json"), JSON.stringify(summary, null, 2) + "\n");
await client.end();
console.log(JSON.stringify(summary, null, 2));

// W11 follow-up: FKs via pg_constraint, marketing schema, INSERT-only drift.
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
  if (!m) throw new Error(`${key} missing`);
  let v = m[1];
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
  return v;
}

function ident(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`unsafe: ${name}`);
  return `"${name}"`;
}

const client = new pg.Client({
  connectionString: readEnvKey("DATABASE_URL"),
  connectionTimeoutMillis: 10000,
  statement_timeout: 180000,
  ssl: { rejectUnauthorized: false }
});
await client.connect();

const fkCountInfo = await client.query(`
  SELECT count(*)::bigint AS n
    FROM information_schema.table_constraints
   WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public'
`);

const pgFks = await client.query(`
  SELECT
    n.nspname AS schema,
    c.relname AS child_table,
    a.attname AS child_column,
    pn.nspname AS parent_schema,
    p.relname AS parent_table,
    pa.attname AS parent_column,
    con.confdeltype AS delete_type,
    con.conname
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_class p ON p.oid = con.confrelid
  JOIN pg_namespace pn ON pn.oid = p.relnamespace
  JOIN unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
  JOIN unnest(con.confkey) WITH ORDINALITY AS pk(attnum, ord) ON pk.ord = ck.ord
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ck.attnum
  JOIN pg_attribute pa ON pa.attrelid = p.oid AND pa.attnum = pk.attnum
  WHERE con.contype = 'f'
    AND n.nspname = 'public'
  ORDER BY c.relname, a.attname
`);

const marketing = await client.query(`
  SELECT n.nspname AS schema, c.relname AS name, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'marketing'
     AND c.relkind IN ('r','v','m')
   ORDER BY c.relname
`);

const marketingCounts = [];
for (const t of marketing.rows.filter((r) => r.relkind === "r")) {
  try {
    const r = await client.query(`SELECT count(*)::bigint AS n FROM marketing.${ident(t.name)}`);
    marketingCounts.push({ table: `marketing.${t.name}`, row_count: Number(r.rows[0].n), readable: true });
  } catch (e) {
    marketingCounts.push({ table: `marketing.${t.name}`, readable: false, error: e.message });
  }
}

const otherSchemaProbe = [];
for (const schema of ["auth", "storage", "realtime", "vault"]) {
  try {
    const r = await client.query(`
      SELECT count(*)::int AS n
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind = 'r'
    `, [schema]);
    otherSchemaProbe.push({ schema, table_count_visible: r.rows[0].n, note: "names visible in pg_class; row counts not queried (PII risk / grants unknown)" });
  } catch (e) {
    otherSchemaProbe.push({ schema, error: e.message });
  }
}

const delMap = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };
const fks = pgFks.rows.map((r) => ({
  child_table: r.child_table,
  child_column: r.child_column,
  parent_table: r.parent_table,
  parent_column: r.parent_column,
  delete_rule: delMap[r.delete_type] || r.delete_type,
  constraint_name: r.conname
}));

const fkOrphans = [];
const seen = new Set();
for (const fk of fks) {
  const key = `${fk.child_table}.${fk.child_column}->${fk.parent_table}.${fk.parent_column}`;
  if (seen.has(key)) continue;
  seen.add(key);
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
    if (n > 0) fkOrphans.push({ ...fk, orphan_count: n });
  } catch (e) {
    fkOrphans.push({ ...fk, error: e.message });
  }
}

const setNullLeft = [];
for (const fk of fks.filter((f) => f.delete_rule === "SET NULL")) {
  try {
    const r = await client.query(`
      SELECT count(*)::bigint AS n FROM ${ident(fk.child_table)} WHERE ${ident(fk.child_column)} IS NULL
    `);
    const n = Number(r.rows[0].n);
    if (n > 0) setNullLeft.push({ ...fk, null_count: n });
  } catch (e) {
    setNullLeft.push({ ...fk, error: e.message });
  }
}

const usage = JSON.parse(fs.readFileSync(path.join(HERE, "table_usage.json"), "utf8"));
const columns = JSON.parse(fs.readFileSync(path.join(HERE, "columns.json"), "utf8"));
const live = new Map();
for (const c of columns) {
  if (!live.has(c.table_name)) live.set(c.table_name, new Set());
  live.get(c.table_name).add(c.column_name);
}

const insertMissing = [];
const insertUnwritten = [];
for (const u of usage) {
  const liveCols = live.get(u.table) || new Set();
  const written = new Set(u.insert_columns || []);
  for (const c of written) {
    if (!liveCols.has(c)) insertMissing.push({ table: u.table, column: c, files: [...(u.writers.api || []), ...(u.writers.src || [])].slice(0, 8) });
  }
  if (!u.insert_dynamic && written.size > 0) {
    for (const c of liveCols) {
      if (["id", "created_at", "updated_at", "archived_at"].includes(c)) continue;
      if (!written.has(c) && !(u.update_columns || []).includes(c)) {
        insertUnwritten.push({ table: u.table, column: c });
      }
    }
  }
}

const policies = JSON.parse(fs.readFileSync(path.join(HERE, "rls_policies.json"), "utf8"));
const rlsByTable = new Map();
for (const p of policies) {
  if (!rlsByTable.has(p.tablename)) rlsByTable.set(p.tablename, []);
  rlsByTable.get(p.tablename).push(p);
}

function kindOf(p) {
  const q = `${p.qual || ""} ${p.with_check || ""}`;
  if (/fundhub_current_partner/.test(q)) return "partner_isolation";
  if (q.trim() === "true true" || (p.qual === "true" && p.with_check === "true")) return "open_door";
  if (p.qual === "true" && !p.with_check) return "open_read";
  return "other";
}

const rlsKinds = [];
const coverage = JSON.parse(fs.readFileSync(path.join(HERE, "rls_coverage.json"), "utf8"));
for (const t of coverage) {
  const ps = rlsByTable.get(t.table_name) || [];
  const kinds = [...new Set(ps.map(kindOf))];
  rlsKinds.push({
    table: t.table_name,
    rls_enabled: t.rls_enabled,
    rls_forced: t.rls_forced,
    policy_count: ps.length,
    kinds,
    policies: ps.map((p) => ({
      name: p.policyname,
      roles: p.roles,
      cmd: p.cmd,
      kind: kindOf(p),
      using: p.qual,
      with_check: p.with_check
    }))
  });
}

fs.writeFileSync(path.join(HERE, "foreign_keys_pg.json"), JSON.stringify(fks, null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "orphans_fk.json"), JSON.stringify(fkOrphans, null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "orphans_set_null.json"), JSON.stringify(setNullLeft, null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "marketing_tables.json"), JSON.stringify({ tables: marketing.rows, counts: marketingCounts }, null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "other_schemas.json"), JSON.stringify(otherSchemaProbe, null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "column_drift_insert_missing.json"), JSON.stringify(insertMissing, null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "column_drift_insert_unwritten.json"), JSON.stringify(insertUnwritten, null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "rls_kinds.json"), JSON.stringify(rlsKinds, null, 2) + "\n");

const summary = {
  information_schema_fk_count: Number(fkCountInfo.rows[0].n),
  pg_constraint_fk_count: fks.length,
  fk_orphan_rows: fkOrphans,
  set_null_null_pointer_pairs: setNullLeft.length,
  marketing_tables: marketing.rows.length,
  insert_columns_missing_on_live: insertMissing,
  rls_kind_counts: rlsKinds.reduce((acc, t) => {
    const k = t.policy_count === 0 ? "bare_rls" : t.kinds.sort().join("+");
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {})
};
fs.writeFileSync(path.join(HERE, "fk_rls_summary.json"), JSON.stringify(summary, null, 2) + "\n");
await client.end();
console.log(JSON.stringify(summary, null, 2));

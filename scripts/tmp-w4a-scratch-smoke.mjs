#!/usr/bin/env node
/**
 * W4a scratch smoke (cloud): CREATE DATABASE on same host, clone only tables
 * needed for 160/161 smoke, apply migrations, card counts before/after.
 * NEVER logs secrets. Drops scratch at end.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const INTENDED_NEW_KEYS = [
  "intake",
  "awaiting_documents",
  "analysis",
  "letters_generated",
  "ready_to_send",
  "in_transit",
  "awaiting_response",
  "response_received",
  "round_complete",
  "program_complete",
  "on_hold",
  "stalled",
  "cancelled"
];
const RETIRED_KEYS = ["round_sent", "bureau_processing", "portal_updated", "upgrade_invite"];
const REMAP = {
  round_sent: "in_transit",
  bureau_processing: "awaiting_response",
  portal_updated: "response_received",
  upgrade_invite: "program_complete"
};

/** Minimal set: 161 remap + 160 FK targets + migration bookkeeping */
const CLONE_TABLES = [
  "schema_migrations",
  "orgs",
  "clients",
  "staff",
  "pipelines",
  "pipeline_stages",
  "cards"
];

function redact(url) {
  const u = new URL(String(url).replace(/^postgres(ql)?:/i, "http:"));
  const host = u.hostname;
  return {
    host,
    database: u.pathname.replace(/^\//, ""),
    user: u.username,
    provider: host.includes("supabase")
      ? "supabase"
      : host.includes("neon")
        ? "neon"
        : host.includes("pooler.supabase")
          ? "supabase"
          : "other"
  };
}

function withDb(url, dbName) {
  const raw = String(url);
  const u = new URL(raw.replace(/^postgres(ql)?:/i, "http:"));
  u.pathname = `/${dbName}`;
  const scheme = raw.startsWith("postgresql") ? "postgresql:" : "postgres:";
  return u.toString().replace(/^http:/i, scheme);
}

function toDirectHost(url) {
  // Session pooler cannot CREATE DATABASE; prefer db.<ref>.supabase.co if pooler
  const raw = String(url);
  const u = new URL(raw.replace(/^postgres(ql)?:/i, "http:"));
  if (u.hostname.includes("pooler.supabase.com")) {
    // aws-0-us-west-2.pooler.supabase.com + user postgres.<ref> → db.<ref>.supabase.co
    const user = u.username || "";
    const m = user.match(/^postgres\.([a-z0-9]+)$/i);
    if (m) {
      u.hostname = `db.${m[1]}.supabase.co`;
      u.port = "5432";
      u.username = "postgres";
      const scheme = raw.startsWith("postgresql") ? "postgresql:" : "postgres:";
      return u.toString().replace(/^http:/i, scheme);
    }
  }
  return raw;
}

async function cardCounts(client) {
  const r = await client.query(`
    SELECT COALESCE(ps.key, '(null)') AS stage_key, count(*)::int AS n
      FROM cards c
      JOIN pipeline_stages ps ON ps.id = c.stage_id
      JOIN pipelines p ON p.id = ps.pipeline_id AND p.key = 'optimization'
     GROUP BY ps.key
     ORDER BY ps.key
  `);
  return r.rows;
}

async function copyTable(src, dest, table) {
  const exists = await src.query(
    `SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=$1`,
    [table]
  );
  if (!exists.rowCount) {
    console.log("CLONE_SKIP_MISSING", table);
    return;
  }
  const cols = await src.query(
    `SELECT a.attname AS name,
            pg_catalog.format_type(a.atttypid, a.atttypmod) AS typ,
            a.attnotnull AS notnull,
            pg_get_expr(ad.adbin, ad.adrelid) AS def
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE n.nspname='public' AND c.relname=$1
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [table]
  );
  await dest.query(`DROP TABLE IF EXISTS public."${table}" CASCADE`);
  const colSql = cols.rows
    .map((c) => {
      let s = `"${c.name}" ${c.typ}`;
      if (c.def) s += ` DEFAULT ${c.def}`;
      // defer NOT NULL until after load for easier ordering
      return s;
    })
    .join(", ");
  await dest.query(`CREATE TABLE public."${table}" (${colSql})`);

  const data = await src.query(`SELECT * FROM public."${table}"`);
  if (!data.rows.length) {
    console.log("CLONE_EMPTY", table);
    return;
  }
  const colnames = data.fields.map((f) => f.name);
  const colList = colnames.map((c) => `"${c}"`).join(", ");
  const chunk = 100;
  for (let i = 0; i < data.rows.length; i += chunk) {
    const slice = data.rows.slice(i, i + chunk);
    const values = [];
    const parts = [];
    let p = 1;
    for (const row of slice) {
      const ph = [];
      for (const c of colnames) {
        ph.push(`$${p++}`);
        let v = row[c];
        // node-pg returns js objects for json/jsonb — leave as-is
        values.push(v);
      }
      parts.push(`(${ph.join(",")})`);
    }
    await dest.query(
      `INSERT INTO public."${table}" (${colList}) VALUES ${parts.join(",")}`,
      values
    );
  }
  console.log("CLONE_OK", table, data.rows.length);
}

async function main() {
  const rawUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "";
  if (!rawUrl) {
    console.error("FAIL: missing DB URL");
    process.exit(1);
  }
  if (rawUrl.includes("****") || /@base(\/|:|$)/.test(rawUrl)) {
    console.error("FAIL: masked URL");
    process.exit(1);
  }

  const url = toDirectHost(rawUrl);
  const meta = redact(url);
  console.log("DB_HOST", meta.host);
  console.log("DB_PROVIDER", meta.provider);
  console.log("DB_NAME", meta.database);
  console.log("DB_USER", meta.user);
  console.log("USED_DIRECT_REWRITE", url !== rawUrl);

  const scratchName = `fh_w4a_${Date.now().toString(36)}`;
  console.log("SCRATCH_DB", scratchName);

  const maintUrl = withDb(url, "postgres");
  let admin = new pg.Client({
    connectionString: maintUrl,
    connectionTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await admin.connect();
    console.log("ADMIN_DB", "postgres");
  } catch (e) {
    console.log("ADMIN_POSTGRES_FAIL", String(e.message || e).slice(0, 150));
    await admin.end().catch(() => {});
    admin = new pg.Client({
      connectionString: url,
      connectionTimeoutMillis: 30000,
      ssl: { rejectUnauthorized: false }
    });
    await admin.connect();
    console.log("ADMIN_DB", "app");
  }

  try {
    await admin.query(`CREATE DATABASE "${scratchName}"`);
    console.log("SCRATCH_CREATED");
  } catch (e) {
    console.error("FAIL_CREATE_DATABASE", String(e.message || e).slice(0, 400));
    process.exit(2);
  }

  const src = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false }
  });
  const dest = new pg.Client({
    connectionString: withDb(url, scratchName),
    connectionTimeoutMillis: 30000,
    statement_timeout: 0,
    ssl: { rejectUnauthorized: false }
  });

  let exit = 0;
  try {
    await src.connect();
    await dest.connect();
    try {
      await dest.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    } catch {
      /* */
    }
    try {
      await dest.query("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"");
    } catch {
      /* */
    }

    for (const t of CLONE_TABLES) {
      await copyTable(src, dest, t);
    }

    // PKs needed for FK inserts in 160
    for (const t of ["orgs", "clients", "pipelines", "pipeline_stages", "cards"]) {
      try {
        await dest.query(`ALTER TABLE public."${t}" ADD PRIMARY KEY (id)`);
      } catch (e) {
        console.log("PK_SKIP", t, String(e.message || e).slice(0, 80));
      }
    }

    console.log("BEFORE_COUNTS");
    const before = await cardCounts(dest);
    for (const r of before) console.log("BEFORE", r.stage_key, r.n);
    const beforeMap = Object.fromEntries(before.map((r) => [r.stage_key, r.n]));

    const sql160 = fs.readFileSync(
      path.join(ROOT, "db/migrations/160_metro2_dispute_engine.sql"),
      "utf8"
    );
    const sql161 = fs.readFileSync(
      path.join(ROOT, "db/migrations/161_optimization_repair_pipeline.sql"),
      "utf8"
    );

    await dest.query("BEGIN");
    try {
      await dest.query(sql160);
      await dest.query(
        `INSERT INTO schema_migrations (key) VALUES ('migrations/160_metro2_dispute_engine.sql') ON CONFLICT DO NOTHING`
      );
      console.log("APPLIED_160");
      await dest.query(sql161);
      await dest.query(
        `INSERT INTO schema_migrations (key) VALUES ('migrations/161_optimization_repair_pipeline.sql') ON CONFLICT DO NOTHING`
      );
      console.log("APPLIED_161");
      await dest.query("COMMIT");
    } catch (e) {
      await dest.query("ROLLBACK");
      console.error("FAIL_APPLY", String(e.message || e).slice(0, 600));
      process.exit(3);
    }

    const t160 = await dest.query(`
      SELECT tablename FROM pg_tables
       WHERE schemaname='public' AND tablename LIKE 'dispute_%'
          OR tablename IN ('furnisher_mail_addresses','repair_decision_log')
       ORDER BY 1
    `);
    console.log(
      "TABLES_160",
      t160.rows.map((r) => r.tablename).join(",")
    );

    // Smoke: write one repair path row
    const org = await dest.query(`SELECT id FROM orgs LIMIT 1`);
    const client = await dest.query(`SELECT id FROM clients LIMIT 1`);
    if (org.rowCount && client.rowCount) {
      const ins = await dest.query(
        `INSERT INTO dispute_cases (org_id, client_id, bureau, round, status)
         VALUES ($1,$2,'EX','R1','open')
         RETURNING id`,
        [org.rows[0].id, client.rows[0].id]
      );
      await dest.query(
        `INSERT INTO dispute_items (case_id, org_id, client_id, rule_id, severity, round, status)
         VALUES ($1,$2,$3,'smoke_rule','high','R1','open')`,
        [ins.rows[0].id, org.rows[0].id, client.rows[0].id]
      );
      await dest.query(
        `INSERT INTO dispute_letters (case_id, org_id, client_id, bureau, round, status, body_text)
         VALUES ($1,$2,$3,'EX','R1','generated',$4)`,
        [ins.rows[0].id, org.rows[0].id, client.rows[0].id, "W4a smoke letter R1"]
      );
      await dest.query(
        `INSERT INTO repair_decision_log (org_id, client_id, case_id, decision, payload)
         VALUES ($1,$2,$3,'W4A_SMOKE',$4::jsonb)`,
        [org.rows[0].id, client.rows[0].id, ins.rows[0].id, JSON.stringify({ ok: true })]
      );
      console.log("REPAIR_WRITE_OK", ins.rows[0].id);
    } else {
      console.log("REPAIR_WRITE_SKIP", "no org/client");
      exit = Math.max(exit, 5);
    }

    console.log("AFTER_COUNTS");
    const after = await cardCounts(dest);
    for (const r of after) console.log("AFTER", r.stage_key, r.n);

    for (const [from, to] of Object.entries(REMAP)) {
      console.log(
        "REMAP",
        from,
        "->",
        to,
        "before_from",
        beforeMap[from] || 0,
        "after_to",
        after.find((x) => x.stage_key === to)?.n || 0
      );
    }

    const bad = await dest.query(
      `
      SELECT c.id::text AS card_id, ps.key AS stage_key
        FROM cards c
        JOIN pipeline_stages ps ON ps.id = c.stage_id
        JOIN pipelines p ON p.id = ps.pipeline_id AND p.key = 'optimization'
       WHERE ps.key = ANY($1::text[])
          OR NOT (ps.key = ANY($2::text[]) OR ps.key = ANY($1::text[]))
    `,
      [RETIRED_KEYS, INTENDED_NEW_KEYS]
    );
    // Split flags
    const retired = bad.rows.filter((r) => RETIRED_KEYS.includes(r.stage_key));
    const unexpected = bad.rows.filter((r) => !RETIRED_KEYS.includes(r.stage_key));
    console.log("FLAG_STILL_ON_RETIRED", retired.length);
    for (const r of retired.slice(0, 40)) console.log("FLAG_RETIRED", r.card_id, r.stage_key);
    console.log("FLAG_UNEXPECTED_STAGE", unexpected.length);
    for (const r of unexpected.slice(0, 40))
      console.log("FLAG_UNEXPECTED", r.card_id, r.stage_key);

    if (retired.length || unexpected.length) {
      console.log("W4A_SMOKE", "FAIL_FLAGS");
      exit = Math.max(exit, 4);
    } else {
      console.log("W4A_SMOKE", "PASS");
    }
  } finally {
    try {
      await src.end();
    } catch {
      /* */
    }
    try {
      await dest.end();
    } catch {
      /* */
    }
    try {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname=$1 AND pid <> pg_backend_pid()`,
        [scratchName]
      );
      await admin.query(`DROP DATABASE IF EXISTS "${scratchName}"`);
      console.log("SCRATCH_DROPPED");
    } catch (e) {
      console.log("SCRATCH_DROP_FAIL", String(e.message || e).slice(0, 200));
    }
    try {
      await admin.end();
    } catch {
      /* */
    }
  }
  process.exit(exit);
}

main().catch((e) => {
  console.error("FAIL", e && e.message ? e.message : String(e));
  process.exit(1);
});

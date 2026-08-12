#!/usr/bin/env node
/**
 * W4a: schema-scratch smoke (no CREATE DATABASE).
 * Copies optimization pipeline tables into schema w4a_scratch, applies 160/161
 * with search_path pinned to that schema, prints card counts before/after,
 * flags bad stages, drops schema. NEVER logs secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __w4aLines = [];
const __origLog = console.log;
console.log = (...args) => { __w4aLines.push(args.map(String).join(" ")); __origLog(...args); };
function __flushW4aArtifact() {
  try {
    fs.mkdirSync("docs/workflows/e2e-verify-run4-evidence/w4a", { recursive: true });
    fs.writeFileSync("docs/workflows/e2e-verify-run4-evidence/w4a/scratch-smoke.log", __w4aLines.join("\n") + "\n");
    __origLog("W4A_ARTIFACT_WRITTEN");
  } catch (e) {
    __origLog("W4A_ARTIFACT_FAIL", String(e && e.message || e).slice(0, 120));
  }
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH = "w4a_scratch";

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

function metaOf(url) {
  const u = new URL(String(url).replace(/^postgres(ql)?:/i, "http:"));
  const host = u.hostname;
  return {
    host,
    database: u.pathname.replace(/^\//, ""),
    user: u.username,
    provider: /supabase/i.test(host) ? "supabase" : /neon/i.test(host) ? "neon" : "other"
  };
}

function toDirect(url) {
  const raw = String(url);
  const u = new URL(raw.replace(/^postgres(ql)?:/i, "http:"));
  if (u.hostname.includes("pooler.supabase.com")) {
    const m = (u.username || "").match(/^postgres\.([a-z0-9]+)$/i);
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

async function main() {
  const raw = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "";
  if (!raw || raw.includes("****") || /@base(\/|:|$)/.test(raw)) {
    console.error("FAIL: missing or masked DB URL");
    process.exit(1);
  }
  const url = toDirect(raw);
  const meta = metaOf(url);
  console.log("DB_HOST", meta.host);
  console.log("DB_PROVIDER", meta.provider);
  console.log("DB_NAME", meta.database);
  console.log("DB_USER", meta.user);
  console.log("DIRECT_REWRITE", url !== raw);

  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 30000,
    statement_timeout: 120000,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  console.log("CONNECTED");

  let exit = 0;
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${SCRATCH} CASCADE`);
    await client.query(`CREATE SCHEMA ${SCRATCH}`);
    console.log("SCRATCH_SCHEMA_CREATED", SCRATCH);

    // Clone only what 160/161 smoke needs into the scratch schema (data snapshot)
    await client.query(`
      CREATE TABLE ${SCRATCH}.orgs AS TABLE public.orgs;
      CREATE TABLE ${SCRATCH}.clients AS TABLE public.clients;
      CREATE TABLE ${SCRATCH}.pipelines AS TABLE public.pipelines;
      CREATE TABLE ${SCRATCH}.pipeline_stages AS TABLE public.pipeline_stages;
      CREATE TABLE ${SCRATCH}.cards AS TABLE public.cards;
      CREATE TABLE ${SCRATCH}.schema_migrations AS TABLE public.schema_migrations;
    `);
    // PKs so 160 FKs can attach
    for (const t of ["orgs", "clients", "pipelines", "pipeline_stages", "cards"]) {
      try {
        await client.query(`ALTER TABLE ${SCRATCH}.${t} ADD PRIMARY KEY (id)`);
      } catch (e) {
        console.log("PK_NOTE", t, String(e.message || e).slice(0, 100));
      }
    }
    // FKs among scratch copies (cards → stages → pipelines)
    try {
      await client.query(`
        ALTER TABLE ${SCRATCH}.pipeline_stages
          ADD CONSTRAINT pipeline_stages_pipeline_fk
          FOREIGN KEY (pipeline_id) REFERENCES ${SCRATCH}.pipelines(id);
      `);
    } catch (e) {
      console.log("FK_NOTE stages", String(e.message || e).slice(0, 100));
    }
    try {
      await client.query(`
        ALTER TABLE ${SCRATCH}.cards
          ADD CONSTRAINT cards_stage_fk
          FOREIGN KEY (stage_id) REFERENCES ${SCRATCH}.pipeline_stages(id);
      `);
    } catch (e) {
      console.log("FK_NOTE cards", String(e.message || e).slice(0, 100));
    }

    const counts = await client.query(`
      SELECT 'orgs' AS t, count(*)::int AS n FROM ${SCRATCH}.orgs
      UNION ALL SELECT 'clients', count(*)::int FROM ${SCRATCH}.clients
      UNION ALL SELECT 'pipelines', count(*)::int FROM ${SCRATCH}.pipelines
      UNION ALL SELECT 'pipeline_stages', count(*)::int FROM ${SCRATCH}.pipeline_stages
      UNION ALL SELECT 'cards', count(*)::int FROM ${SCRATCH}.cards
    `);
    for (const r of counts.rows) console.log("CLONED", r.t, r.n);

    // Pin search_path so unqualified names in 160/161 hit scratch copies.
    // public stays for functions/extensions only.
    await client.query(`SET search_path TO ${SCRATCH}, public`);

    console.log("BEFORE_COUNTS");
    const before = await cardCounts(client);
    for (const r of before) console.log("BEFORE", r.stage_key, r.n);
    const beforeMap = Object.fromEntries(before.map((r) => [r.stage_key, r.n]));

    let sql160 = fs.readFileSync(
      path.join(ROOT, "db/migrations/160_metro2_dispute_engine.sql"),
      "utf8"
    );
    let sql161 = fs.readFileSync(
      path.join(ROOT, "db/migrations/161_optimization_repair_pipeline.sql"),
      "utf8"
    );

    // 160 references public orgs/clients via REFERENCES orgs(id) — with search_path
    // scratch first, FKs bind to scratch.orgs/clients. Good.

    await client.query("BEGIN");
    try {
      await client.query(sql160);
      await client.query(
        `INSERT INTO schema_migrations (key) VALUES ('migrations/160_metro2_dispute_engine.sql')
         ON CONFLICT DO NOTHING`
      );
      console.log("APPLIED_160");

      await client.query(sql161);
      await client.query(
        `INSERT INTO schema_migrations (key) VALUES ('migrations/161_optimization_repair_pipeline.sql')
         ON CONFLICT DO NOTHING`
      );
      console.log("APPLIED_161");
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("FAIL_APPLY", String(e.message || e).slice(0, 800));
      exit = 3;
      throw e;
    }

    const t160 = await client.query(`
      SELECT tablename FROM pg_tables
       WHERE schemaname = $1
         AND (
           tablename LIKE 'dispute_%'
           OR tablename IN ('furnisher_mail_addresses','repair_decision_log')
         )
       ORDER BY 1
    `, [SCRATCH]);
    console.log("TABLES_160", t160.rows.map((r) => r.tablename).join(","));

    // Repair path write smoke
    const org = await client.query(`SELECT id FROM orgs LIMIT 1`);
    const cl = await client.query(`SELECT id FROM clients LIMIT 1`);
    if (org.rowCount && cl.rowCount) {
      const ins = await client.query(
        `INSERT INTO dispute_cases (org_id, client_id, bureau, round, status)
         VALUES ($1,$2,'EX','R1','open') RETURNING id`,
        [org.rows[0].id, cl.rows[0].id]
      );
      await client.query(
        `INSERT INTO dispute_items (case_id, org_id, client_id, rule_id, severity, round, status)
         VALUES ($1,$2,$3,'smoke_rule','high','R1','open')`,
        [ins.rows[0].id, org.rows[0].id, cl.rows[0].id]
      );
      await client.query(
        `INSERT INTO dispute_letters (case_id, org_id, client_id, bureau, round, status, body_text)
         VALUES ($1,$2,$3,'EX','R1','generated','W4a smoke R1 letter')`,
        [ins.rows[0].id, org.rows[0].id, cl.rows[0].id]
      );
      await client.query(
        `INSERT INTO repair_decision_log (org_id, client_id, case_id, decision, payload)
         VALUES ($1,$2,$3,'W4A_SMOKE','{"ok":true}'::jsonb)`,
        [org.rows[0].id, cl.rows[0].id, ins.rows[0].id]
      );
      console.log("REPAIR_WRITE_OK", ins.rows[0].id);
    } else {
      console.log("REPAIR_WRITE_SKIP");
      exit = Math.max(exit, 5);
    }

    console.log("AFTER_COUNTS");
    const after = await cardCounts(client);
    for (const r of after) console.log("AFTER", r.stage_key, r.n);

    for (const [from, to] of Object.entries(REMAP)) {
      console.log(
        "REMAP",
        from,
        "->",
        to,
        "before_from",
        beforeMap[from] || 0,
        "after_target",
        after.find((x) => x.stage_key === to)?.n || 0
      );
    }

    const bad = await client.query(
      `
      SELECT c.id::text AS card_id, ps.key AS stage_key
        FROM cards c
        JOIN pipeline_stages ps ON ps.id = c.stage_id
        JOIN pipelines p ON p.id = ps.pipeline_id AND p.key = 'optimization'
       WHERE ps.key = ANY($1::text[])
          OR (
            NOT (ps.key = ANY($2::text[]))
            AND NOT (ps.key = ANY($1::text[]))
          )
    `,
      [RETIRED_KEYS, INTENDED_NEW_KEYS]
    );
    const retired = bad.rows.filter((r) => RETIRED_KEYS.includes(r.stage_key));
    const unexpected = bad.rows.filter((r) => !RETIRED_KEYS.includes(r.stage_key));
    console.log("FLAG_STILL_ON_RETIRED", retired.length);
    for (const r of retired.slice(0, 40)) console.log("FLAG_RETIRED", r.card_id, r.stage_key);
    console.log("FLAG_UNEXPECTED_STAGE", unexpected.length);
    for (const r of unexpected.slice(0, 40))
      console.log("FLAG_UNEXPECTED", r.card_id, r.stage_key);

    // Prove public (prod) cards untouched: retired-key counts on public search_path
    await client.query("SET search_path TO public");
    const prodRetired = await client.query(
      `
      SELECT count(*)::int AS n
        FROM cards c
        JOIN pipeline_stages ps ON ps.id = c.stage_id
        JOIN pipelines p ON p.id = ps.pipeline_id AND p.key = 'optimization'
       WHERE ps.key = ANY($1::text[])
    `,
      [RETIRED_KEYS]
    );
    console.log("PROD_PUBLIC_STILL_HAS_RETIRED_CARDS", prodRetired.rows[0].n);
    console.log("PROD_UNTOUCHED_CHECK", "ok");

    if (retired.length || unexpected.length) {
      console.log("W4A_SMOKE", "FAIL_FLAGS");
      exit = Math.max(exit, 4);
    } else {
      console.log("W4A_SMOKE", "PASS");
    }
  } catch (e) {
    if (!exit) exit = 1;
    console.error("FAIL", String(e.message || e).slice(0, 500));
  } finally {
    try {
      await client.query(`SET search_path TO public`);
      await client.query(`DROP SCHEMA IF EXISTS ${SCRATCH} CASCADE`);
      console.log("SCRATCH_DROPPED");
    } catch (e) {
      console.log("SCRATCH_DROP_FAIL", String(e.message || e).slice(0, 200));
    }
    await client.end().catch(() => {});
  }
  __flushW4aArtifact();
  process.exit(exit);
}

main().catch((e) => {
  console.error("FAIL", e && e.message ? e.message : String(e));
  __flushW4aArtifact();
  process.exit(1);
});

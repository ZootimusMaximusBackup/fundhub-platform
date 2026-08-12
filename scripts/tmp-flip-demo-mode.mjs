#!/usr/bin/env node
import pg from "pg";

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "";
if (!url) { console.error("FAIL: MIGRATION_DATABASE_URL/DATABASE_URL missing"); process.exit(1); }
console.log(
  "USING",
  process.env.MIGRATION_DATABASE_URL ? "MIGRATION_DATABASE_URL" : "DATABASE_URL"
);
if (url.includes("****") || /^[*]+$/.test(url.replace(/\s/g,"")) || /@base(\/|:|$)/.test(url)) {
  console.error("FAIL: DATABASE_URL looks masked or host=base");
  process.exit(1);
}
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error("FAIL: DATABASE_URL is not a postgres URL shape");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000, statement_timeout: 20000 });
try {
  await client.connect();
  await client.query("SELECT 1 AS ok");
  console.log("PING: ok");

  const before = await client.query("SELECT id, slug, name, is_default, demo_mode_enabled FROM orgs ORDER BY slug");
  console.log("ORGS_BEFORE_COUNT", before.rows.length);
  for (const r of before.rows) {
    console.log("ORG_ROW", JSON.stringify({ id: r.id, slug: r.slug, name: r.name, is_default: r.is_default, demo_mode_enabled: r.demo_mode_enabled }));
  }

  let target = before.rows.find((r) => r.slug === "fundhub");
  if (!target) target = before.rows.find((r) => r.is_default === true);
  if (!target) target = before.rows.find((r) => String(r.name || "").toLowerCase().includes("fundhub"));
  if (!target) {
    console.error("STOP: no fundhub/default org; see ORG_ROW lines");
    process.exit(2);
  }
  console.log("TARGET", JSON.stringify({ id: target.id, slug: target.slug }));

  const upd = await client.query(
    `UPDATE orgs SET demo_mode_enabled = false, updated_at = now()
     WHERE id = $1
     RETURNING id, slug, is_default, demo_mode_enabled`,
    [target.id]
  );
  console.log("UPDATE_ROWCOUNT", upd.rowCount);
  console.log("ORGS_AFTER_UPDATE", JSON.stringify(upd.rows[0] || null));
  if (upd.rowCount !== 1 || upd.rows[0]?.demo_mode_enabled !== false) {
    console.error("STOP: update did not leave demo_mode_enabled=false");
    process.exit(3);
  }
  console.log("FLIP_OK");
} catch (err) {
  console.error("FAIL:", err && err.message ? err.message : String(err));
  process.exit(1);
} finally {
  try { await client.end(); } catch {}
}

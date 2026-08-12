#!/usr/bin/env node
// One-shot: flip orgs.demo_mode_enabled off using Netlify-injected DATABASE_URL.
// NEVER logs the connection string. Delete after use.
import pg from "pg";

const url = process.env.DATABASE_URL || "";
if (!url) {
  console.error("FAIL: DATABASE_URL missing in build env");
  process.exit(1);
}
if (url.includes("****") || setOfStars(url) || /@base(\/|:|$)/.test(url) || url === "base") {
  console.error("FAIL: DATABASE_URL looks masked or host=base");
  process.exit(1);
}
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error("FAIL: DATABASE_URL is not a postgres URL shape");
  process.exit(1);
}

function setOfStars(s) {
  const t = s.replace(/\s/g, "");
  return t.length > 0 && /^[*]+$/.test(t);
}

const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 10000,
  statement_timeout: 15000
});

try {
  await client.connect();
  const ping = await client.query("SELECT 1 AS ok");
  if (ping.rows[0]?.ok !== 1) throw new Error("SELECT 1 failed");
  console.log("PING: ok");

  const before = await client.query(
    "SELECT id, slug, demo_mode_enabled FROM orgs ORDER BY slug"
  );
  console.log("ORGS_BEFORE_COUNT", before.rows.length);
  for (const r of before.rows) {
    console.log(
      "ORG_ROW",
      JSON.stringify({
        id: r.id,
        slug: r.slug,
        demo_mode_enabled: r.demo_mode_enabled
      })
    );
  }

  const fundhub = before.rows.find((r) => r.slug === "fundhub");
  if (!fundhub) {
    console.error("STOP: no slug=fundhub — slugs=", before.rows.map((r) => r.slug).join(","));
    process.exit(2);
  }

  const upd = await client.query(
    `UPDATE orgs
        SET demo_mode_enabled = false, updated_at = now()
      WHERE slug = 'fundhub'
      RETURNING id, slug, demo_mode_enabled`
  );
  console.log("UPDATE_ROWCOUNT", upd.rowCount);
  if (upd.rowCount !== 1) {
    console.error("STOP: expected 1 row updated");
    process.exit(3);
  }
  console.log("ORGS_AFTER_UPDATE", JSON.stringify(upd.rows[0]));
  if (upd.rows[0].demo_mode_enabled !== false) {
    console.error("STOP: demo_mode_enabled still not false");
    process.exit(4);
  }
  console.log("FLIP_OK");
} catch (err) {
  console.error("FAIL:", err && err.message ? err.message : String(err));
  process.exit(1);
} finally {
  try { await client.end(); } catch { /* ignore */ }
}

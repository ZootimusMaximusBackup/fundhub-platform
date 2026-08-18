// DELETE this sim client only. Count leftovers. Never touch live or P1.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-response-loop-2026-08-19-evidence/dumps");
const BASE = "https://fundhub.ai";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const P1 = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const session = JSON.parse(fs.readFileSync("/tmp/p3-response-loop-session.json", "utf8"));

function loadDotEnv() {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();
const PASSWORD = process.env.STAFF_E2E_PASSWORD || "";

function db() {
  return new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}
async function query(sql, params = []) {
  const c = db();
  await c.connect();
  try { return (await c.query(sql, params)).rows; }
  finally { await c.end(); }
}

const WATCH = [
  "clients", "events", "documents", "tradelines", "crs_results",
  "contracts", "contract_signers", "messages", "consents", "client_consents",
  "cards", "conversations", "tasks", "opt_outs", "account_magic_links", "accounts"
];

async function counts(id) {
  const tables = (await query(`
    SELECT table_name FROM information_schema.columns
     WHERE table_schema='public' AND column_name='client_id'
       AND table_name NOT LIKE 'v_%'
     ORDER BY 1
  `)).map((r) => r.table_name);
  const out = {};
  for (const t of tables) {
    try {
      const r = await query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE client_id = $1`, [id]);
      if (r[0].n) out[t] = r[0].n;
    } catch { /* skip */ }
  }
  const client = await query(`SELECT id, is_demo FROM clients WHERE id = $1`, [id]);
  return { client_present: client.length > 0, is_demo: client[0] && client[0].is_demo, nonempty: out, tables_checked: tables.length };
}

async function main() {
  if (session.client_id === FORBIDDEN || session.client_id === P1) throw new Error("refuse reserved id");
  const before = await counts(session.client_id);
  fs.writeFileSync(path.join(OUT, "30-orphans-before.json"), JSON.stringify(before, null, 2));

  const liveBefore = await query(`SELECT id FROM clients WHERE id = $1`, [FORBIDDEN]);
  const p1Before = await query(`SELECT id FROM clients WHERE id = $1`, [P1]);

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
  });
  const token = (await loginRes.json()).token;
  const delRes = await fetch(`${BASE}/api/demo/simulate`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      cookie: `fundhub_session=${token}`
    },
    body: JSON.stringify({ client_id: session.client_id })
  });
  const delJson = await delRes.json().catch(() => ({}));
  fs.writeFileSync(path.join(OUT, "31-delete.json"), JSON.stringify({
    status: delRes.status,
    ok: delJson.ok === true,
    count: delJson.count ?? null,
    removed_ids: Array.isArray(delJson.removed) ? delJson.removed.map((r) => r.id) : null,
    error: delJson.error || null
  }, null, 2));

  await new Promise((r) => setTimeout(r, 1000));
  const after = await counts(session.client_id);
  const liveAfter = await query(`SELECT id FROM clients WHERE id = $1`, [FORBIDDEN]);
  const p1After = await query(`SELECT id FROM clients WHERE id = $1`, [P1]);

  const leftover_count = Object.values(after.nonempty).reduce((a, b) => a + b, 0) + (after.client_present ? 1 : 0);
  // If client is gone, don't double-count clients table
  const leftover = { ...after.nonempty };
  if (after.client_present) leftover.clients = leftover.clients || 1;

  const named = {};
  for (const t of WATCH) {
    if (leftover[t]) named[t] = leftover[t];
  }

  const summary = {
    client_id: session.client_id,
    delete_status: delRes.status,
    client_gone: !after.client_present,
    leftover_tables: leftover,
    leftover_named: named,
    leftover_row_count: Object.values(leftover).reduce((a, b) => a + b, 0),
    live_file_still_present: liveAfter.length === 1 && liveBefore.length === 1,
    p1_still_present: p1After.length === p1Before.length,
    live_or_p1_deleted: liveAfter.length === 0 || (p1Before.length && p1After.length === 0)
  };
  fs.writeFileSync(path.join(OUT, "32-orphans-after.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({
    delete_status: delRes.status,
    client_gone: summary.client_gone,
    leftover_row_count: summary.leftover_row_count,
    leftover_named: named,
    live_file_still_present: summary.live_file_still_present,
    p1_still_present: summary.p1_still_present
  }));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});

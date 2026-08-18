// W-INTAKE — create one simulated client via live POST /api/demo/simulate.
// Findings only. Writes evidence + SHARED.json. Does not teardown.

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-intake");
const SHARED = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/SHARED.json");
const BASE = "https://fundhub.ai";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const COMPARE = "8556bedc-46e1-4d85-b0cd-a24adfee1521";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

const PASSWORD = process.env.STAFF_E2E_PASSWORD || process.env.STAFF_INITIAL_PASSWORD || "";
if (!PASSWORD) throw new Error("STAFF_E2E_PASSWORD missing");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
fs.mkdirSync(OUT, { recursive: true });

function db() {
  return new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function query(sql, params = []) {
  const c = db();
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

const proofs = [];
function rec(row) {
  proofs.push(row);
  console.log(JSON.stringify({ id: row.id, result: row.result, observed: row.observed }));
}

async function main() {
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  const setCookie = loginRes.headers.get("set-cookie") || "";
  const token = loginJson.token || null;
  fs.writeFileSync(path.join(OUT, "login-status.json"), JSON.stringify({
    status: loginRes.status,
    ok: loginJson.ok === true,
    has_token: Boolean(token),
    has_set_cookie: /fundhub_session=/i.test(setCookie),
    staff_role: loginJson.staff?.role || null
  }, null, 2));

  if (!token) {
    rec({
      id: "intake.login",
      result: "FAIL",
      expected: "owner session",
      observed: `login status ${loginRes.status}`,
      evidence: "w-intake/login-status.json"
    });
    throw new Error("login failed");
  }
  rec({
    id: "intake.login",
    result: "PASS",
    expected: "owner session",
    observed: `status ${loginRes.status} role ${loginJson.staff?.role || "?"}`,
    evidence: "w-intake/login-status.json"
  });

  const simRes = await fetch(`${BASE}/api/demo/simulate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      cookie: `fundhub_session=${token}`
    },
    body: JSON.stringify({})
  });
  const simJson = await simRes.json().catch(() => ({}));
  fs.writeFileSync(path.join(OUT, "simulate-post.json"), JSON.stringify({
    status: simRes.status,
    ok: simJson.ok,
    client_id: simJson.client_id || null,
    crs_id: simJson.crs_id || null,
    email: simJson.email || null,
    card_id: simJson.card_id || null,
    tradeline_count: simJson.tradeline_count ?? null,
    href: simJson.href || null,
    error: simJson.error || null
  }, null, 2));

  const clientId = simJson.client_id || null;
  if (!clientId || simRes.status !== 200 || simJson.ok !== true) {
    rec({
      id: "intake.simulate",
      result: "FAIL",
      expected: "200 + client_id + crs_id + email",
      observed: `status ${simRes.status} error ${simJson.error || "none"}`,
      evidence: "w-intake/simulate-post.json"
    });
    throw new Error("simulate failed");
  }
  if (clientId === FORBIDDEN) throw new Error("simulate returned forbidden live id");
  rec({
    id: "intake.simulate",
    result: "PASS",
    expected: "200 + simulated client ids",
    observed: `client_id ${clientId} crs_id ${simJson.crs_id} email ${simJson.email}`,
    evidence: "w-intake/simulate-post.json"
  });

  const clients = await query(
    `SELECT id, org_id, email, first_name, last_name, phone, is_demo, tags,
            outcome_tier, channel_source
       FROM clients WHERE id = $1`,
    [clientId]
  );
  const crs = await query(
    `SELECT id, org_id, client_id, outcome_tier,
            jsonb_typeof(result) AS result_type
       FROM crs_results WHERE id = $1`,
    [simJson.crs_id]
  );
  const tradelines = await query(
    `SELECT id, client_id, creditor_name, account_identifier, bureau, account_type
       FROM tradelines WHERE client_id = $1 ORDER BY creditor_name`,
    [clientId]
  );
  const cards = await query(
    `SELECT id, client_id, pipeline_id, stage_id, owner
       FROM cards WHERE client_id = $1`,
    [clientId]
  );
  const banks = await query(
    `SELECT id, client_id, name, account_type, mask
       FROM bank_accounts WHERE client_id = $1`,
    [clientId]
  ).catch(() => []);

  const clientRow = clients[0] || null;
  fs.writeFileSync(path.join(OUT, "client-row.json"), JSON.stringify({
    count: clients.length,
    row: clientRow && {
      id: clientRow.id,
      org_id: clientRow.org_id,
      email: clientRow.email,
      first_name: clientRow.first_name,
      last_name: clientRow.last_name,
      phone: clientRow.phone ? "present" : null,
      is_demo: clientRow.is_demo,
      tags: clientRow.tags,
      outcome_tier: clientRow.outcome_tier,
      channel_source: clientRow.channel_source
    }
  }, null, 2));
  fs.writeFileSync(path.join(OUT, "crs-row.json"), JSON.stringify({
    count: crs.length,
    row: crs[0] || null
  }, null, 2));
  fs.writeFileSync(path.join(OUT, "tradelines.json"), JSON.stringify({
    count: tradelines.length,
    rows: tradelines
  }, null, 2));
  fs.writeFileSync(path.join(OUT, "pipeline-card.json"), JSON.stringify({
    count: cards.length,
    rows: cards,
    creates_one_if_sales_stage_exists: "src/demo/simulate-client.mjs firstSalesStage + INSERT cards"
  }, null, 2));
  fs.writeFileSync(path.join(OUT, "bank-accounts.json"), JSON.stringify({
    count: banks.length,
    rows: banks.map((b) => ({ id: b.id, name: b.name, account_type: b.account_type, mask: b.mask }))
  }, null, 2));

  rec({
    id: "intake.client_row",
    result: clientRow && clientRow.is_demo === true ? "PASS" : "FAIL",
    expected: "clients row is_demo=true named Simulated Client",
    observed: clientRow
      ? `${clientRow.first_name} ${clientRow.last_name} is_demo=${clientRow.is_demo} tier=${clientRow.outcome_tier}`
      : "no row",
    evidence: "w-intake/client-row.json"
  });
  rec({
    id: "intake.crs_row",
    result: crs.length === 1 && crs[0].client_id === clientId ? "PASS" : "FAIL",
    expected: "one crs_results row for this client",
    observed: `count=${crs.length} crs_id=${crs[0]?.id || null}`,
    evidence: "w-intake/crs-row.json"
  });
  rec({
    id: "intake.tradelines",
    result: tradelines.length >= 4 ? "PASS" : "FAIL",
    expected: "4 seeded tradelines via ingestCrsResult",
    observed: `count=${tradelines.length} names=${tradelines.map((t) => t.creditor_name).join(" | ")}`,
    evidence: "w-intake/tradelines.json"
  });
  rec({
    id: "intake.pipeline_card",
    result: cards.length >= 1 ? "PASS" : "FAIL",
    expected: "pipeline card created when sales stage exists",
    observed: cards.length ? `card_id=${cards[0].id}` : "no card — simulate inserts only if firstSalesStage finds sales pipeline",
    evidence: "w-intake/pipeline-card.json"
  });
  rec({
    id: "intake.not_forbidden",
    result: clientId !== FORBIDDEN && clientId !== COMPARE ? "PASS" : "FAIL",
    expected: "new id, not live file, not compare client",
    observed: clientId,
    evidence: "w-intake/simulate-post.json"
  });

  const shared = {
    created_at: new Date().toISOString(),
    client_id: clientId,
    crs_id: simJson.crs_id,
    email: simJson.email,
    card_id: simJson.card_id || (cards[0] && cards[0].id) || null,
    org_id: clientRow?.org_id || null,
    phone_present: Boolean(clientRow?.phone),
    tradeline_count: tradelines.length,
    forbidden_live: FORBIDDEN,
    read_compare: COMPARE,
    base: BASE
  };
  fs.writeFileSync(SHARED, JSON.stringify(shared, null, 2));
  fs.writeFileSync(path.join(OUT, "proofs.json"), JSON.stringify(proofs, null, 2));
  console.log(JSON.stringify({ shared, proofs: proofs.map((p) => p.id + "=" + p.result) }, null, 2));
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});

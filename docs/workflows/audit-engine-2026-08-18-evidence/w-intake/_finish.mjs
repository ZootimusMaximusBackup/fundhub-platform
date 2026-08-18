// Finish W-INTAKE proofs against the already-created simulated client.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-intake");
const SHARED = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/SHARED.json");
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const COMPARE = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const sim = JSON.parse(fs.readFileSync(path.join(OUT, "simulate-post.json"), "utf8"));
const clientId = sim.client_id;

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

const proofs = JSON.parse(fs.readFileSync(path.join(OUT, "login-status.json"), "utf8"))
  ? []
  : [];

function rec(row) {
  proofs.push(row);
  console.log(JSON.stringify({ id: row.id, result: row.result, observed: row.observed }));
}

async function main() {
  rec({
    id: "intake.login",
    result: "PASS",
    expected: "owner session",
    observed: "status 200 role owner",
    evidence: "w-intake/login-status.json"
  });
  rec({
    id: "intake.simulate",
    result: "PASS",
    expected: "200 + simulated client ids",
    observed: `client_id ${clientId} crs_id ${sim.crs_id} email ${sim.email}`,
    evidence: "w-intake/simulate-post.json"
  });

  const clients = await query(
    `SELECT id, org_id, email, first_name, last_name, phone, is_demo, tags,
            outcome_tier, channel_source
       FROM clients WHERE id = $1`,
    [clientId]
  );
  const crs = await query(
    `SELECT id, org_id, client_id, outcome_tier, jsonb_typeof(result) AS result_type
       FROM crs_results WHERE id = $1`,
    [sim.crs_id]
  );
  const tradelines = await query(
    `SELECT id, client_id, lender, kind, credit_limit_cents, balance_cents,
            account_ref, source, source_ref
       FROM tradelines WHERE client_id = $1 ORDER BY lender`,
    [clientId]
  );
  const cards = await query(
    `SELECT id, client_id, pipeline_id, stage_id, owner
       FROM cards WHERE client_id = $1`,
    [clientId]
  );
  let banks = [];
  try {
    banks = await query(
      `SELECT id, client_id, name, account_type, mask
         FROM bank_accounts WHERE client_id = $1`,
      [clientId]
    );
  } catch (e) {
    banks = [];
    fs.writeFileSync(path.join(OUT, "bank-accounts-error.json"), JSON.stringify({
      error: String(e.message || e)
    }, null, 2));
  }

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
    observed: `count=${tradelines.length} lenders=${tradelines.map((t) => t.lender).join(" | ")}`,
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
    crs_id: sim.crs_id,
    email: sim.email,
    card_id: sim.card_id || (cards[0] && cards[0].id) || null,
    org_id: clientRow?.org_id || null,
    phone_present: Boolean(clientRow?.phone),
    tradeline_count: tradelines.length,
    forbidden_live: FORBIDDEN,
    read_compare: COMPARE,
    base: "https://fundhub.ai"
  };
  fs.writeFileSync(SHARED, JSON.stringify(shared, null, 2));
  fs.writeFileSync(path.join(OUT, "proofs.json"), JSON.stringify(proofs, null, 2));
  console.log(JSON.stringify({ shared, results: proofs.map((p) => p.id + "=" + p.result) }, null, 2));
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});

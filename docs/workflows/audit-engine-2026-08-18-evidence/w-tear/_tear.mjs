// W-TEAR — DELETE this simulated client only. Prove gone. List orphans.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-tear");
const SHARED = JSON.parse(fs.readFileSync(
  path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/SHARED.json"),
  "utf8"
));
const CLIENT = SHARED.client_id;
const FORBIDDEN = SHARED.forbidden_live;
const COMPARE = SHARED.read_compare;
const BASE = "https://fundhub.ai";

const KNOWN = {
  inquiry_case: "d1635579-eda9-4961-8ca8-50abe7151ecf",
  ftc_doc: "bf55375a-b4c7-48aa-8241-9b818bc60c82",
  consent: "7057e732-9411-4512-98b9-23a7a1fe7d77",
  contract: "82f9232a-3c6d-4cd5-85eb-b4995e4f539a",
  signed_pdf: "864fd394-7ba8-43e3-b7c5-77befaa51540",
  sale: "75429aa0-2105-4e4d-858a-1b57b605f4ed"
};

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
fs.mkdirSync(OUT, { recursive: true });

function dbc() {
  return new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function withDb(fn) {
  const c = dbc();
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function snapshot(label) {
  return withDb(async (c) => {
    const tables = (await c.query(`
      SELECT table_name
        FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'client_id'
       ORDER BY table_name
    `)).rows.map((r) => r.table_name);

    const byTable = {};
    for (const t of tables) {
      try {
        const r = await c.query(
          `SELECT COUNT(*)::int AS n FROM ${t} WHERE client_id = $1`,
          [CLIENT]
        );
        if (r.rows[0].n > 0) byTable[t] = r.rows[0].n;
      } catch (e) {
        byTable[t] = { error: String(e.message || e) };
      }
    }

    const client = (await c.query(
      `SELECT id, email, is_demo FROM clients WHERE id = $1`,
      [CLIENT]
    )).rows;
    const forbiddenStill = (await c.query(
      `SELECT id FROM clients WHERE id = $1`,
      [FORBIDDEN]
    )).rows.length;
    const compareStill = (await c.query(
      `SELECT id FROM clients WHERE id = $1`,
      [COMPARE]
    )).rows.length;

    const known = {};
    const probes = [
      ["inquiry_removal_cases", KNOWN.inquiry_case],
      ["documents", KNOWN.ftc_doc],
      ["documents", KNOWN.signed_pdf],
      ["client_consents", KNOWN.consent],
      ["contracts", KNOWN.contract],
      ["sales", KNOWN.sale]
    ];
    for (const [table, id] of probes) {
      try {
        const r = await c.query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
        known[table + ":" + id] = r.rows.length;
      } catch (e) {
        known[table + ":" + id] = String(e.message || e);
      }
    }

    const contracts = (await c.query(
      `SELECT id, status FROM contracts WHERE client_id = $1`,
      [CLIENT]
    ).catch(() => ({ rows: [] }))).rows;
    const events = (await c.query(
      `SELECT name, COUNT(*)::int AS n FROM events WHERE client_id = $1 GROUP BY name ORDER BY name`,
      [CLIENT]
    ).catch(() => ({ rows: [] }))).rows;
    const docs = (await c.query(
      `SELECT id, subtype FROM documents WHERE client_id = $1`,
      [CLIENT]
    ).catch(() => ({ rows: [] }))).rows;

    return {
      label,
      at: new Date().toISOString(),
      client_present: client.length > 0,
      client,
      forbidden_still: forbiddenStill,
      compare_still: compareStill,
      tables_with_client_id_rows: byTable,
      known_ids: known,
      contracts,
      events_by_name: events,
      documents: docs.map((d) => ({ id: d.id, subtype: d.subtype }))
    };
  });
}

async function main() {
  if (CLIENT === FORBIDDEN || CLIENT === COMPARE) throw new Error("refusing teardown of forbidden/compare id");

  const before = await snapshot("before");
  fs.writeFileSync(path.join(OUT, "before.json"), JSON.stringify(before, null, 2));

  const PASSWORD = process.env.STAFF_E2E_PASSWORD || "";
  if (!PASSWORD) throw new Error("STAFF_E2E_PASSWORD missing");
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  const token = loginJson.token;
  if (!token) throw new Error("login failed " + loginRes.status);

  const delRes = await fetch(`${BASE}/api/demo/simulate`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      cookie: `fundhub_session=${token}`
    },
    body: JSON.stringify({ client_id: CLIENT })
  });
  const delJson = await delRes.json().catch(() => ({}));
  fs.writeFileSync(path.join(OUT, "delete-response.json"), JSON.stringify({
    status: delRes.status,
    ok: delJson.ok,
    count: delJson.count,
    removed: delJson.removed || null,
    error: delJson.error || null
  }, null, 2));

  const after = await snapshot("after");
  fs.writeFileSync(path.join(OUT, "after.json"), JSON.stringify(after, null, 2));

  const orphans = Object.entries(after.tables_with_client_id_rows)
    .filter(([, n]) => (typeof n === "number" ? n > 0 : true))
    .map(([table, n]) => ({ table, count: n }));
  const knownLeft = Object.entries(after.known_ids)
    .filter(([, n]) => n !== 0)
    .map(([k, n]) => ({ key: k, count: n }));

  const proofs = [
    {
      id: "tear.delete",
      result: delRes.status === 200 && delJson.ok === true ? "PASS" : "FAIL",
      expected: "DELETE /api/demo/simulate { client_id } 200",
      observed: `status ${delRes.status} count=${delJson.count} removed=${JSON.stringify(delJson.removed)}`,
      evidence: "w-tear/delete-response.json"
    },
    {
      id: "tear.client_gone",
      result: after.client_present === false ? "PASS" : "FAIL",
      expected: "clients row gone",
      observed: after.client_present ? "still present" : "gone",
      evidence: "w-tear/after.json"
    },
    {
      id: "tear.others_untouched",
      result: after.forbidden_still === 1 && after.compare_still === 1 ? "PASS" : "FAIL",
      expected: "live file and compare client still exist",
      observed: `forbidden=${after.forbidden_still} compare=${after.compare_still}`,
      evidence: "w-tear/after.json"
    },
    {
      id: "tear.orphans",
      result: orphans.length === 0 && knownLeft.length === 0 ? "PASS" : "FAIL",
      expected: "no leftover rows for this client_id; known audit ids gone",
      observed: JSON.stringify({ orphans, knownLeft, contracts: after.contracts, documents: after.documents }),
      evidence: "w-tear/orphans.json"
    }
  ];

  fs.writeFileSync(path.join(OUT, "orphans.json"), JSON.stringify({
    orphans,
    known_ids_left: knownLeft,
    contracts_left: after.contracts,
    documents_left: after.documents,
    events_left: after.events_by_name,
    before_tables: before.tables_with_client_id_rows,
    after_tables: after.tables_with_client_id_rows
  }, null, 2));
  fs.writeFileSync(path.join(OUT, "proofs.json"), JSON.stringify(proofs, null, 2));
  console.log(JSON.stringify({
    delete: proofs[0].observed,
    client_gone: proofs[1].result,
    others: proofs[2].result,
    orphans,
    knownLeft
  }, null, 2));
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});

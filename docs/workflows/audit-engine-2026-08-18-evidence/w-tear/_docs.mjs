// Finish teardown: documents blocked by document_versions. THIS client only.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { teardownSimulated } from "../../../../src/demo/simulate-client.mjs";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-tear");
const SHARED = JSON.parse(fs.readFileSync(
  path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/SHARED.json"),
  "utf8"
));
const CLIENT = SHARED.client_id;
const ORG = SHARED.org_id;
const FORBIDDEN = SHARED.forbidden_live;

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

async function main() {
  if (CLIENT === FORBIDDEN) throw new Error("refuse");
  const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await c.connect();
  const demo = await c.query(`SELECT id, is_demo FROM clients WHERE id = $1`, [CLIENT]);
  if (!demo.rows[0] || demo.rows[0].is_demo !== true) throw new Error("not demo");

  const docs = (await c.query(
    `SELECT id FROM documents WHERE client_id = $1`,
    [CLIENT]
  )).rows;
  await c.query(
    `UPDATE documents SET current_version_id = NULL WHERE client_id = $1`,
    [CLIENT]
  );
  let versions = 0;
  for (const d of docs) {
    const r = await c.query(`DELETE FROM document_versions WHERE document_id = $1`, [d.id]);
    versions += r.rowCount;
  }
  const delDocs = await c.query(`DELETE FROM documents WHERE client_id = $1 RETURNING id`, [CLIENT]);

  let designed;
  try {
    designed = await teardownSimulated(c, { orgId: ORG, clientId: CLIENT });
  } catch (e) {
    designed = { error: String(e.message || e) };
  }

  const still = (await c.query(`SELECT id FROM clients WHERE id = $1`, [CLIENT])).rows;
  const leftoverDocs = (await c.query(`SELECT id FROM documents WHERE client_id = $1`, [CLIENT])).rows;
  const forbidden = (await c.query(`SELECT id FROM clients WHERE id = $1`, [FORBIDDEN])).rows.length;
  await c.end();

  const out = {
    docs_seen: docs.map((d) => d.id),
    versions_deleted: versions,
    documents_deleted: delDocs.rows.map((r) => r.id),
    designed,
    client_gone: still.length === 0,
    leftover_docs: leftoverDocs.length,
    forbidden_still: forbidden
  };
  fs.writeFileSync(path.join(OUT, "local-docs.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});

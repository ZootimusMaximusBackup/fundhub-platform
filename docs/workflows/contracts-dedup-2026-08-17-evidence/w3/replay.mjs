// W3 evidence — the four things the Documents screen must be able to do for a
// contract, driven through the real handlers with a real session, against a
// real Postgres. Writes docs/workflows/contracts-dedup-2026-08-17-evidence/w3/.
//
// It cleans up after itself with the same purge the endpoint tests use.
// No secret value is ever written out: the session token is replaced with
// "<redacted>" and pdf bytes are truncated to a length + first 24 chars.

import { writeFileSync, mkdirSync } from "node:fs";
import { db, close } from "/Users/zootimusmaximus/fundhub-platform/src/db.mjs";
import { resolveDefaultOrg } from "/Users/zootimusmaximus/fundhub-platform/src/auth/org.mjs";
import { createSession } from "/Users/zootimusmaximus/fundhub-platform/src/auth/session.mjs";
import writeHandler from "/Users/zootimusmaximus/fundhub-platform/api/contracts.mjs";
import readHandler from "/Users/zootimusmaximus/fundhub-platform/api/read/contracts.mjs";

const OUT = "/Users/zootimusmaximus/fundhub-platform/docs/workflows/contracts-dedup-2026-08-17-evidence/w3";
const CLIENT_EMAIL = "contract.w3.evidence@example.com";
const STAFF_EMAIL_LIKE = "contract_w3_evidence_%@example.com";
const KEY_LIKE = "CTW3-%";
const SECRET = "E".repeat(48);

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

async function withTriggerDisabled(table, trigger, fn) {
  await db.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  try { return await fn(); } finally { await db.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`); }
}

const trim = (body) => JSON.parse(JSON.stringify(body, (k, v) => {
  if (k === "pdf_base64" && typeof v === "string") return `<${v.length} base64 chars> ${v.slice(0, 24)}…`;
  if (k === "rendered_body" && typeof v === "string" && v.length > 120) return `${v.slice(0, 120)}…`;
  return v;
}));

const log = [];
const record = (what, request, r) => {
  log.push({ what, request, status: r.code, headers: r.headers, response: trim(r.body) });
  console.log(`${r.code}  ${what}`);
};

async function purge() {
  const ids = (await db.query(`SELECT id FROM clients WHERE email = $1`, [CLIENT_EMAIL])).rows.map((r) => r.id);
  if (ids.length) {
    await withTriggerDisabled("contract_signers", "trg_contract_signers_no_delete", () =>
      db.query(`DELETE FROM contract_signers WHERE contract_id IN (SELECT id FROM contracts WHERE client_id = ANY($1))`, [ids]));
    await withTriggerDisabled("contracts", "trg_contracts_no_delete", () =>
      db.query(`DELETE FROM contracts WHERE client_id = ANY($1)`, [ids]));
    await withTriggerDisabled("documents", "trg_documents_no_delete", () =>
      withTriggerDisabled("document_versions", "trg_document_versions_no_delete", async () => {
        await db.query(`UPDATE documents SET current_version_id = NULL WHERE client_id = ANY($1)`, [ids]);
        await db.query(`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE client_id = ANY($1))`, [ids]);
        await db.query(`DELETE FROM documents WHERE client_id = ANY($1)`, [ids]);
      }));
    await db.query(`DELETE FROM messages WHERE client_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM tasks WHERE client_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM events WHERE client_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
  }
  await withTriggerDisabled("contract_templates", "trg_contract_templates_no_delete", () =>
    db.query(`DELETE FROM contract_templates WHERE template_key LIKE $1`, [KEY_LIKE]));
  await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
}

async function main() {
  process.env.CONTRACT_URL_SECRET = SECRET;
  const org = await resolveDefaultOrg(db);
  await purge();

  const ownerId = (await db.query(
    `INSERT INTO staff (org_id, name, role, email, status)
     VALUES ($1,'W3 Evidence Owner','owner',$2,'active') RETURNING id`,
    [org, "contract_w3_evidence_owner@example.com"])).rows[0].id;
  const closerId = (await db.query(
    `INSERT INTO staff (org_id, name, role, email, status)
     VALUES ($1,'W3 Evidence Closer','closer',$2,'active') RETURNING id`,
    [org, "contract_w3_evidence_closer@example.com"])).rows[0].id;
  const ownerTok = (await createSession(db, { staffId: ownerId, orgId: org })).token;
  const closerTok = (await createSession(db, { staffId: closerId, orgId: org })).token;
  const clientId = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email)
     VALUES ($1,'Wanda','Watcher',$2) RETURNING id`, [org, CLIENT_EMAIL])).rows[0].id;

  const post = async (body, token) => {
    const r = res();
    await writeHandler({ method: "POST", query: {}, body, headers: { authorization: "Bearer " + token } }, r);
    return r;
  };
  const read = async (query, token) => {
    const r = res();
    await readHandler({ method: "GET", query, headers: { authorization: "Bearer " + token } }, r);
    return r;
  };

  // ── set up: a template, a draft, a send ──────────────────────────────────
  const t = await post({
    action: "create_template", template_key: "CTW3-EVIDENCE", name: "W3 Evidence Agreement",
    body: "Fee {{field.fee}} for {{contact.full_name}}.",
    manual_fields: [{ key: "fee", label: "Fee", required: true }]
  }, ownerTok);
  const d = await post({
    action: "create_draft", client_id: clientId, template_id: t.body.template.id, values: { fee: "10%" }
  }, closerTok);
  const s = await post({ action: "send", id: d.body.contract.id }, closerTok);
  const contract = s.body.contract;
  console.log(`setup: contract ${contract.id}  document ${contract.document_id}`);

  // ── a. status, starting from a documents row id ──────────────────────────
  record("a. status — GET /api/read/contracts?view=contracts&document_id=<documents.id>",
    { method: "GET", path: "/api/read/contracts", query: { view: "contracts", document_id: contract.document_id }, as: "closer" },
    await read({ view: "contracts", document_id: contract.document_id }, closerTok));

  record("a2. junk document_id is refused",
    { method: "GET", path: "/api/read/contracts", query: { view: "contracts", document_id: "zzz" }, as: "closer" },
    await read({ view: "contracts", document_id: "zzz" }, closerTok));

  // ── b. the file ──────────────────────────────────────────────────────────
  record("b. download — GET /api/read/contracts?file=contract&id=<contract id>",
    { method: "GET", path: "/api/read/contracts", query: { file: "contract", id: contract.id }, as: "closer" },
    await read({ file: "contract", id: contract.id }, closerTok));

  // ── d. remind (before void, so there is something to remind) ─────────────
  record("d. remind — POST /api/contracts {action:'remind'} as an ordinary closer",
    { method: "POST", path: "/api/contracts", body: { action: "remind", id: contract.id }, as: "closer" },
    await post({ action: "remind", id: contract.id }, closerTok));

  // ── c. void ──────────────────────────────────────────────────────────────
  record("c. void refused for a non-admin",
    { method: "POST", path: "/api/contracts", body: { action: "void", id: contract.id, reason: "evidence" }, as: "closer" },
    await post({ action: "void", id: contract.id, reason: "evidence" }, closerTok));

  record("c2. void — POST /api/contracts {action:'void'} as owner",
    { method: "POST", path: "/api/contracts", body: { action: "void", id: contract.id, reason: "evidence run" }, as: "owner" },
    await post({ action: "void", id: contract.id, reason: "evidence run" }, ownerTok));

  record("d2. a voided contract cannot be reminded",
    { method: "POST", path: "/api/contracts", body: { action: "remind", id: contract.id }, as: "owner" },
    await post({ action: "remind", id: contract.id }, ownerTok));

  // ── the shapes the Contracts screen still depends on ─────────────────────
  const tpl = await read({ view: "templates", active_only: "1" }, closerTok);
  log.push({
    what: "regression — ?view=templates still answers (contract-send.js depends on it)",
    request: { method: "GET", path: "/api/read/contracts", query: { view: "templates", active_only: "1" }, as: "closer" },
    status: tpl.code,
    response: { ok: tpl.body.ok, view: tpl.body.view, count: tpl.body.count, note: "items omitted — whole library" }
  });
  console.log(`${tpl.code}  regression ?view=templates`);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/api-calls.json`, JSON.stringify({
    ran_at: new Date().toISOString(),
    ran_against: "local Postgres 16.14 (Homebrew), database fundhub_ci, migrations applied through 156",
    note: "Handlers called directly with a real sessions row, the same way src/http/contracts-endpoints.pg.test.mjs does. Session tokens are never written to this file.",
    calls: log
  }, null, 2) + "\n");
  console.log(`\nwrote ${OUT}/api-calls.json`);

  await purge();
}

main().then(() => close()).catch(async (err) => {
  console.error("FAILED", err);
  try { await purge(); } catch { /* nothing */ }
  await close();
  process.exitCode = 1;
});

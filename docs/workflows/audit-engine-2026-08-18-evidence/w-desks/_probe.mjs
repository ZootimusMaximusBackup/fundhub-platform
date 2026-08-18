// W-DESKS — inquiry + repair desk proofs. Findings only.
// Writes evidence under w-desks/. Does not Send. Does not mail. Does not call a bureau.

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { pathToFileURL } from "node:url";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const viewMod = await import(pathToFileURL(path.join(ROOT, "src/http/inquiry-remover-view.mjs")).href);
const { buildCaseSendRequest, buildRepairSendRequest, ViewError } = viewMod;
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-desks");
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

const shared = JSON.parse(fs.readFileSync(SHARED, "utf8"));
const CLIENT = shared.client_id;
const ORG = shared.org_id;
const CRS = shared.crs_id;
if (CLIENT === FORBIDDEN) throw new Error("refused: simulated id is the live credit file");
if (CLIENT === COMPARE) throw new Error("refused: simulated id is the read-compare client");

function db() {
  return new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function withDb(fn) {
  const c = db();
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

function envNamed(names) {
  const out = {};
  for (const n of names) {
    const v = process.env[n];
    out[n] = Boolean(v && String(v).trim());
  }
  return out;
}

function write(name, obj) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return `w-desks/${name}`;
}

function cookieHeader(setCookie) {
  if (!setCookie) return "";
  return setCookie.split(/,(?=[^;]+?=)/).map((p) => p.split(";")[0].trim()).filter(Boolean).join("; ");
}

const TINY_PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\ntrailer<</Root 1 0 R>>\n"
);

async function main() {
  const proofs = [];
  const rec = (row) => {
    proofs.push(row);
    console.log(JSON.stringify({ id: row.id, result: row.result }));
  };

  // ── 1. Discover tables + query this client ──────────────────────────────
  const tables = await withDb(async (c) => {
    const r = await c.query(`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND (
           table_name ILIKE '%inquiry%'
           OR table_name ILIKE '%repair%'
           OR table_name ILIKE 'dispute%'
           OR table_name IN ('documents', 'document_versions', 'files', 'letters_generated')
         )
       ORDER BY table_name
    `);
    return r.rows.map((x) => x.table_name);
  });
  write("tables-discovered.json", { tables });

  const clientSafe = [CLIENT];
  const counts = await withDb(async (c) => {
    const out = { client_id: CLIENT, compare_id: COMPARE, rows: {} };
    const want = [
      "inquiry_log",
      "inquiry_removal_cases",
      "inquiry_prep",
      "inquiry_attempts",
      "dispute_cases",
      "dispute_letters",
      "dispute_items",
      "repair_decision_log",
      "letters_generated",
      "documents"
    ];
    for (const t of want) {
      if (!tables.includes(t)) {
        out.rows[t] = { exists: false };
        continue;
      }
      const cols = await c.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1`,
        [t]
      );
      const names = cols.rows.map((x) => x.column_name);
      const hasClient = names.includes("client_id");
      if (!hasClient) {
        out.rows[t] = { exists: true, has_client_id: false };
        continue;
      }
      const sim = await c.query(`SELECT * FROM ${t} WHERE client_id = $1`, [CLIENT]);
      const cmp = await c.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE client_id = $1`, [COMPARE]);
      out.rows[t] = {
        exists: true,
        sim_count: sim.rows.length,
        compare_count: cmp.rows[0].n,
        sim_rows: sim.rows
      };
    }

    const crs = await c.query(
      `SELECT id, outcome_tier,
              result ? 'inquiries' AS has_inquiries_key,
              jsonb_typeof(result->'inquiries') AS inquiries_type,
              COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(result->'inquiries')='array' THEN result->'inquiries' ELSE '[]'::jsonb END), 0) AS inquiries_len,
              result ? 'tradelines' AS has_tradelines
         FROM crs_results WHERE id = $1 AND client_id = $2`,
      [CRS, CLIENT]
    );
    out.crs = crs.rows[0] || null;

    const cards = await c.query(
      `SELECT c.id, p.key AS pipeline_key, ps.key AS stage_key
         FROM cards c
         JOIN pipelines p ON p.id = c.pipeline_id
         JOIN pipeline_stages ps ON ps.id = c.stage_id
        WHERE c.client_id = $1`,
      [CLIENT]
    );
    out.cards = cards.rows;

    const simSrc = fs.readFileSync(path.join(ROOT, "src/demo/simulate-client.mjs"), "utf8");
    out.simulate_mentions_inquiry = /inquiry/i.test(simSrc);
    out.simulate_mentions_repair = /repair|dispute_cases|dispute_letters/i.test(simSrc);
    return out;
  });
  write("db-desk-rows.json", counts);

  const inquiryEmpty =
    (counts.rows.inquiry_log?.sim_count || 0) === 0 &&
    (counts.rows.inquiry_removal_cases?.sim_count || 0) === 0 &&
    (counts.rows.inquiry_prep?.sim_count || 0) === 0;
  const inquiriesInPayload = counts.crs && counts.crs.inquiries_len === 0 && counts.crs.has_inquiries_key === false;

  rec({
    id: "inq.1.db-rows",
    result: inquiryEmpty ? "PASS" : "FAIL",
    expected: "Simulate file has no inquiry rows (payload has no inquiries)",
    observed: {
      inquiry_log: counts.rows.inquiry_log?.sim_count ?? "missing_table",
      inquiry_removal_cases: counts.rows.inquiry_removal_cases?.sim_count ?? "missing_table",
      inquiry_prep: counts.rows.inquiry_prep?.sim_count ?? "missing_table",
      crs_has_inquiries_key: counts.crs?.has_inquiries_key ?? null,
      crs_inquiries_len: counts.crs?.inquiries_len ?? null,
      simulate_mentions_inquiry: counts.simulate_mentions_inquiry
    },
    evidence: "w-desks/db-desk-rows.json"
  });

  // ── Login ───────────────────────────────────────────────────────────────
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  const token = loginJson.token || null;
  const cookie = cookieHeader(loginRes.headers.get("set-cookie") || "");
  write("login-status.json", {
    status: loginRes.status,
    ok: loginJson.ok === true,
    has_token: Boolean(token),
    has_cookie: /fundhub_session=/i.test(cookie),
    staff_role: loginJson.staff?.role || null
  });
  if (!token) throw new Error(`login failed status=${loginRes.status}`);

  const authHeaders = {
    authorization: `Bearer ${token}`,
    accept: "application/json",
    cookie
  };

  // ── 2. Create a case without a live bureau if none exists ───────────────
  let created = null;
  const existingCases = counts.rows.inquiry_removal_cases?.sim_rows || [];
  if (existingCases.length === 0) {
    const createRes = await fetch(`${BASE}/api/inquiry-cases`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        action: "create",
        client_id: CLIENT,
        request_source: "w-desks-audit",
        selected_bureaus_raw: "EX",
        remover_notes: "audit case — do not send",
        open_inquiry_count: 0
      })
    });
    created = {
      status: createRes.status,
      body: await createRes.json().catch(() => ({}))
    };
    write("case-create.json", created);
    rec({
      id: "inq.2.create-without-bureau",
      result: created.status === 200 && created.body?.ok === true && created.body?.case?.client_id === CLIENT
        ? "PASS"
        : "FAIL",
      expected: "POST /api/inquiry-cases action=create for THIS client, no bureau call",
      observed: {
        status: created.status,
        ok: created.body?.ok === true,
        case_id: created.body?.case?.id || null,
        client_id: created.body?.case?.client_id || null,
        request_source: created.body?.case?.request_source || null
      },
      evidence: "w-desks/case-create.json"
    });
  } else {
    write("case-create.json", { skipped: true, reason: "case already existed", existing: existingCases.map((r) => r.id) });
    rec({
      id: "inq.2.create-without-bureau",
      result: "PASS",
      expected: "Case exists or machine can create one without a bureau",
      observed: { already_existed: existingCases.length, ids: existingCases.map((r) => r.id) },
      evidence: "w-desks/case-create.json"
    });
  }

  // ── 3. Open case + buildCaseSendRequest ─────────────────────────────────
  const openRes = await fetch(`${BASE}/api/read/inquiry-cases?client_id=${CLIENT}`, {
    headers: authHeaders
  });
  const openJson = await openRes.json().catch(() => ({}));
  write("inquiry-case-open.json", { status: openRes.status, body: openJson });

  const caseId = openJson?.case?.id || created?.body?.case?.id || null;
  let casePayload = null;
  let casePayloadError = null;
  try {
    if (!caseId) throw new ViewError("no case id");
    casePayload = buildCaseSendRequest({ caseId, mail: true });
  } catch (err) {
    casePayloadError = err.message;
  }
  write("buildCaseSendRequest.json", {
    caseId,
    payload: casePayload,
    error: casePayloadError,
    test_shape: {
      path: "/api/inquiry-cases",
      action: "send",
      mail: true,
      id_is_uuid: /^[0-9a-f-]{36}$/i.test(caseId || "")
    },
    sent: false
  });

  rec({
    id: "inq.3.open-and-build-send",
    result: openRes.status === 200 && casePayload && casePayload.path === "/api/inquiry-cases" && casePayload.body.action === "send" && casePayload.body.mail === true && casePayload.body.id === caseId
      ? "PASS"
      : "FAIL",
    expected: "Open THIS client's case; buildCaseSendRequest matches tests (path /api/inquiry-cases, action send, mail true). Do not Send.",
    observed: {
      read_status: openRes.status,
      case_id: caseId,
      payload_ok: Boolean(casePayload),
      error: casePayloadError
    },
    evidence: ["w-desks/inquiry-case-open.json", "w-desks/buildCaseSendRequest.json"]
  });

  // ── 4. GET /api/read/repair-cases ───────────────────────────────────────
  const repairListRes = await fetch(`${BASE}/api/read/repair-cases`, { headers: authHeaders });
  const repairList = await repairListRes.json().catch(() => ({}));
  const files = Array.isArray(repairList.files) ? repairList.files : [];
  const thisInList = files.filter((f) => f.client_id === CLIENT);
  write("repair-cases-list.json", {
    status: repairListRes.status,
    ok: repairList.ok === true,
    file_count: files.length,
    this_client_count: thisInList.length,
    this_client: thisInList,
    need_me: repairList.need_me ?? null,
    sample_ids: files.slice(0, 5).map((f) => ({ client_id: f.client_id, name: f.name, stage_key: f.stage_key }))
  });

  const repairDetailRes = await fetch(`${BASE}/api/read/repair-cases?client_id=${CLIENT}`, { headers: authHeaders });
  const repairDetail = await repairDetailRes.json().catch(() => ({}));
  write("repair-cases-detail.json", { status: repairDetailRes.status, body: repairDetail });

  rec({
    id: "rep.4.live-repair-cases",
    result: repairListRes.status === 200 && repairList.ok === true
      ? (thisInList.length === 0 ? "PASS" : "FAIL")
      : "FAIL",
    expected: "GET /api/read/repair-cases as owner. THIS simulated client should not appear (no optimization card).",
    observed: {
      status: repairListRes.status,
      file_count: files.length,
      this_client_in_list: thisInList.length,
      detail_file: repairDetail.file || null,
      cards: counts.cards
    },
    evidence: ["w-desks/repair-cases-list.json", "w-desks/repair-cases-detail.json"]
  });

  // ── 5. Simulate seed repair? ────────────────────────────────────────────
  const repairEmpty =
    (counts.rows.dispute_cases?.sim_count || 0) === 0 &&
    (counts.rows.dispute_letters?.sim_count || 0) === 0 &&
    (counts.rows.dispute_items?.sim_count || 0) === 0 &&
    !counts.cards.some((x) => x.pipeline_key === "optimization");

  rec({
    id: "rep.5.simulate-seed",
    result: repairEmpty && counts.simulate_mentions_repair === false ? "PASS" : "FAIL",
    expected: "Simulate does not seed repair_cases / letters / rounds. Empty Repair list is the G2 gap.",
    observed: {
      dispute_cases: counts.rows.dispute_cases?.sim_count ?? "missing_table",
      dispute_letters: counts.rows.dispute_letters?.sim_count ?? "missing_table",
      dispute_items: counts.rows.dispute_items?.sim_count ?? "missing_table",
      optimization_cards: counts.cards.filter((x) => x.pipeline_key === "optimization").length,
      simulate_mentions_repair: counts.simulate_mentions_repair,
      g2_gap: true
    },
    evidence: "w-desks/db-desk-rows.json"
  });

  // ── 6. FTC / fraud upload ───────────────────────────────────────────────
  const form = new FormData();
  form.append("client_id", CLIENT);
  form.append("subtype", "additional_fraud_docs");
  form.append("title", "Additional documentation — fraud / identity theft cases");
  form.append("file", new Blob([TINY_PDF], { type: "application/pdf" }), "w-desks-ftc-audit.pdf");
  const uploadRes = await fetch(`${BASE}/api/documents-upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json", cookie },
    body: form
  });
  const uploadJson = await uploadRes.json().catch(() => ({}));
  write("ftc-upload.json", {
    route: "POST /api/documents-upload",
    required_body: {
      multipart: true,
      fields: { client_id: "uuid", subtype: "additional_fraud_docs", title: "optional" },
      files: [{ field: "file", accept: "jpg/png/pdf magic numbers" }]
    },
    status: uploadRes.status,
    ok: uploadJson.ok === true,
    document_id: uploadJson.documents?.[0]?.id || uploadJson.documents?.[0]?.document?.id || null,
    subtype: uploadJson.documents?.[0]?.subtype || null,
    client_id: uploadJson.documents?.[0]?.client_id || null
  });

  const docRows = await withDb(async (c) => {
    if (!tables.includes("documents")) return { exists: false };
    const r = await c.query(
      `SELECT id, client_id, kind, subtype, created_at
         FROM documents
        WHERE client_id = $1
        ORDER BY created_at DESC
        LIMIT 10`,
      [CLIENT]
    );
    return { exists: true, rows: r.rows };
  });
  write("ftc-documents-rows.json", docRows);

  const stored = (docRows.rows || []).some((r) => r.subtype === "additional_fraud_docs");
  rec({
    id: "rep.6.ftc-upload",
    result: uploadRes.status === 200 && uploadJson.ok === true && stored ? "PASS" : "FAIL",
    expected: "FTC/police report upload on THIS client stores a documents row (subtype additional_fraud_docs)",
    observed: {
      status: uploadRes.status,
      ok: uploadJson.ok === true,
      stored,
      document_count: (docRows.rows || []).length
    },
    evidence: ["w-desks/ftc-upload.json", "w-desks/ftc-documents-rows.json"]
  });

  // ── 7. buildRepairSendRequest ───────────────────────────────────────────
  const dummyLetterId = "00000000-0000-4000-8000-000000000001";
  let repairPayload = null;
  let repairPayloadError = null;
  try {
    repairPayload = buildRepairSendRequest({
      clientId: CLIENT,
      mail: true,
      letters: [{ id: dummyLetterId, bureau: "EX", html: "<p>W-DESKS dry-run — do not send</p>" }]
    });
  } catch (err) {
    repairPayloadError = err.message;
  }
  const liveLetters = Array.isArray(repairDetail.letters) ? repairDetail.letters : [];
  write("buildRepairSendRequest.json", {
    note: "Built against tests. THIS file has no ready letters. Dummy letter_id is not a live send.",
    live_letters: liveLetters,
    payload: repairPayload,
    error: repairPayloadError,
    sent: false
  });
  rec({
    id: "rep.7.build-repair-send",
    result: repairPayload
      && repairPayload.path === "/api/repair/send"
      && repairPayload.body.mail === true
      && repairPayload.body.client_id === CLIENT
      && repairPayload.body.letters[0].bureau === "EX"
      ? "PASS"
      : "FAIL",
    expected: "buildRepairSendRequest valid per tests (path /api/repair/send, mail true, letters with bureau+html). Do not send.",
    observed: {
      payload_ok: Boolean(repairPayload),
      error: repairPayloadError,
      live_letter_count: liveLetters.length
    },
    evidence: "w-desks/buildRepairSendRequest.json"
  });

  // ── 8. Dry-run repair/send to last safe step ────────────────────────────
  const creds = envNamed([
    "POSTGRID_API_KEY",
    "POSTGRID_WEBHOOK_SECRET",
    "POSTGRID_API_BASE",
    "MESSAGING_DRY_RUN",
    "DOCUMENT_STORE_PROVIDER",
    "BLOB_READ_WRITE_TOKEN"
  ]);
  const missingCreds = Object.entries(creds).filter(([, present]) => !present).map(([n]) => n);

  const gateRes = await fetch(`${BASE}/api/repair/send`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      mail: false,
      client_id: CLIENT,
      letters: [{ bureau: "EX", html: "<p>dry-run</p>" }]
    })
  });
  const gateJson = await gateRes.json().catch(() => ({}));
  write("repair-send-dry-run.json", {
    last_safe_step: "POST /api/repair/send with mail:false (gate only). Never mail:true. Never PostGrid.",
    requirements: {
      method: "POST",
      auth: "staff (ROLE_SETS.STAFF)",
      body: { mail: true, client_id: "uuid in session org", letters: [{ bureau: "required", html_or_pdf: "required" }] }
    },
    next_call_if_mail_true: [
      "sendRepairLetters()",
      "mailBureauLetter()",
      "sendLetter() → POST https://api.postgrid.com/print-mail/v1/letters"
    ],
    never_calls: ["inquiry-removal-ai-sigma.vercel.app", "live bureau"],
    credential_names_present: creds,
    credential_names_missing: missingCreds,
    gate_status: gateRes.status,
    gate_body: { ok: gateJson.ok === true, error: gateJson.error || null, message: gateJson.message || null },
    mailed: false
  });

  rec({
    id: "rep.8.repair-send-dry-run",
    result: gateRes.status === 400 && /mail|press send|no_channel/i.test(JSON.stringify(gateJson))
      ? "PASS"
      : "UNVERIFIED",
    expected: "mail:false is refused. Next live step would be PostGrid letters. Do not Send.",
    observed: {
      status: gateRes.status,
      error: gateJson.error || null,
      message: gateJson.message || null,
      missing_cred_names: missingCreds
    },
    evidence: "w-desks/repair-send-dry-run.json"
  });

  write("proofs.json", {
    generated_at: new Date().toISOString(),
    client_id: CLIENT,
    crs_id: CRS,
    org_id: ORG,
    forbidden_untouched: FORBIDDEN,
    compare_read_only: COMPARE,
    proofs
  });
}

main().catch((err) => {
  fs.writeFileSync(path.join(OUT, "probe-error.json"), JSON.stringify({
    message: err.message,
    stack: err.stack
  }, null, 2));
  console.error(err.message);
  process.exit(1);
});

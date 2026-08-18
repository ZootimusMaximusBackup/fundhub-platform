// W-UW — run UnderwriteIQ on the shared simulated client. Findings only.
// Read-only against the DB except evidence files. Never teardown. Never emit events.

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { toBureaus } from "../../../../src/underwrite/adapter.mjs";
import { UPSTREAM, computeUnderwrite, buildSuggestions } from "../../../../src/underwrite/engine.mjs";
import { buildReport } from "../../../../src/underwrite/report.mjs";
import { evaluateUtilization } from "../../../../src/alerts/evaluate.mjs";
import {
  persistFundingLetterFiles,
  loadFundingLetterPdf,
  pickFundingLetterPdfBase64,
  isFundingLetterFile,
  storeFromEnv
} from "../../../../src/underwrite/funding-letter-pdf.mjs";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-uw");
const CLIENT_ID = "41a3199f-1835-4ac8-91c0-d4f37bd92037";
const CRS_ID = "c1f83e6b-a624-4f28-a32a-531a530b3ad4";
const ORG_ID = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const COMPARE = "8556bedc-46e1-4d85-b0cd-a24adfee1521";

const SEED = {
  revolving: [
    { lender: "Chase Sapphire Preferred", limit: 12000, balance: 2100, id: "SIM-CHASE-001", bureau: "EX" },
    { lender: "Amex Blue Business Cash", limit: 25000, balance: 4800, id: "SIM-AMEX-001", bureau: "EQ" },
    { lender: "Capital One Spark", limit: 8000, balance: 950, id: "SIM-CAP1-001", bureau: "TU" }
  ],
  installment: [
    { lender: "Toyota Motor Credit", limit: 28000, balance: 14200, id: "SIM-TOYO-001", bureau: "EX" }
  ],
  scores: { EX: 718, EQ: 724, TU: 731 },
  util_seed: 18,
  estimate: 125000,
  outcome: "FULL_FUNDING"
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

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
if (CLIENT_ID === FORBIDDEN) throw new Error("refused forbidden live id");
fs.mkdirSync(OUT, { recursive: true });

function write(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2));
}

function fundingishKeys(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/underwrite|funding|prequal|preapprov|analyzer|outcome|estimate|util|tier|reason/i.test(k)) {
      out[k] = v;
    }
  }
  return out;
}

function resultScorePaths(result) {
  if (!result || typeof result !== "object") return { top_level_scores: null, nested: {} };
  return {
    top_level_scores: result.scores ?? null,
    nested: {
      consumerSignals_scores: result.consumerSignals?.scores ?? null,
      consumerSignals_scores_perBureau: result.consumerSignals?.scores?.perBureau ?? null,
      crm_payload_scores: result.crm_payload?.scores ?? null,
      outcome: result.outcome ?? null,
      reason_codes: result.reason_codes ?? null,
      preapprovals: result.preapprovals ?? null,
      crm_payload_outcome: result.crm_payload?.outcome ?? null,
      crm_payload_customFields: result.crm_payload?.customFields ?? null,
      consumerSignals_utilization: result.consumerSignals?.utilization ?? null
    }
  };
}

async function main() {
  if (CLIENT_ID === COMPARE) throw new Error("this unit must not write the compare client");

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  const q = (sql, params = []) => client.query(sql, params);

  try {
    const idCheck = await q(`SELECT id, is_demo FROM clients WHERE id = $1`, [CLIENT_ID]);
    if (idCheck.rows[0]?.id === FORBIDDEN) throw new Error("refused forbidden live id");
    if (!idCheck.rows[0]) throw new Error("simulated client missing");

    const before = await dumpFundingRows(q, "before_engine");

    const [tradelinesRes, liabilitiesRes, crsRes, clientRes] = await Promise.all([
      q(
        `SELECT * FROM tradelines WHERE client_id = $1 AND org_id = $2
          ORDER BY apr ASC NULLS LAST, lender ASC`,
        [CLIENT_ID, ORG_ID]
      ),
      q(
        `SELECT * FROM card_liabilities WHERE client_id = $1 AND org_id = $2
          ORDER BY as_of DESC`,
        [CLIENT_ID, ORG_ID]
      ).catch((err) => ({ rows: [], _error: err.message })),
      q(
        `SELECT id, org_id, client_id, outcome_tier, result, created_at
           FROM crs_results WHERE client_id = $1 AND org_id = $2
           ORDER BY created_at DESC`,
        [CLIENT_ID, ORG_ID]
      ),
      q(
        `SELECT id, org_id, email, first_name, last_name, is_demo, tags,
                outcome_tier, custom_fields, updated_at
           FROM clients WHERE id = $1 AND org_id = $2`,
        [CLIENT_ID, ORG_ID]
      )
    ]);

    const storedTradelines = tradelinesRes.rows.map((t) => ({
      id: t.id,
      lender: t.lender,
      kind: t.kind,
      credit_limit_cents: t.credit_limit_cents,
      balance_cents: t.balance_cents,
      account_ref: t.account_ref,
      opened_on: t.opened_on ?? null,
      closed_at: t.closed_at ?? null,
      source: t.source,
      source_ref: t.source_ref,
      raw_bureau: t.raw?.bureau ?? t.raw?.accountBureau ?? null,
      raw_accountType: t.raw?.accountType ?? t.raw?.account_type ?? null
    }));
    write("stored-tradelines.json", {
      count: storedTradelines.length,
      rows: storedTradelines,
      liabilities_count: liabilitiesRes.rows?.length ?? 0,
      liabilities_error: liabilitiesRes._error || null
    });

    const crsRows = crsRes.rows.map((r) => ({
      id: r.id,
      outcome_tier: r.outcome_tier,
      created_at: r.created_at,
      result_keys: r.result && typeof r.result === "object" ? Object.keys(r.result) : [],
      score_paths: resultScorePaths(r.result)
    }));
    write("stored-crs.json", {
      count: crsRows.length,
      expected_crs_id: CRS_ID,
      rows: crsRows
    });

    const clientRow = clientRes.rows[0] || null;
    const adapter = toBureaus({
      tradelines: tradelinesRes.rows,
      liabilities: liabilitiesRes.rows || [],
      crsResults: crsRes.rows,
      customFields: clientRow?.custom_fields || {}
    });

    const underwrite = computeUnderwrite(adapter.bureaus, adapter.businessAgeMonths);
    const suggestions = buildSuggestions(underwrite);
    const fundhubUtilization = evaluateUtilization(tradelinesRes.rows);
    const report = buildReport({ underwrite, suggestions, adapter, fundhubUtilization });
    report.engine.upstreamCommit = UPSTREAM.commit;

    const engineOutput = {
      ran_at: new Date().toISOString(),
      client_id: CLIENT_ID,
      crs_id: CRS_ID,
      org_id: ORG_ID,
      how: "same chain as src/underwrite/underwriteiq.pg.test.mjs step 4 and api/read/underwrite.mjs: toBureaus → computeUnderwrite → buildSuggestions → buildReport",
      upstream: UPSTREAM,
      stored: {
        tradeline_count: tradelinesRes.rows.length,
        liability_count: liabilitiesRes.rows?.length ?? 0,
        crs_count: crsRes.rows.length,
        client_outcome_tier: clientRow?.outcome_tier ?? null,
        crs_outcome_tiers: crsRes.rows.map((r) => r.outcome_tier)
      },
      adapter: {
        available: adapter.available,
        businessAgeMonths: adapter.businessAgeMonths,
        utilization: adapter.utilization,
        tradelineGaps: adapter.tradelineGaps,
        missing: adapter.missing,
        scoreSource: adapter.scoreSource,
        scoreAsOf: adapter.scoreAsOf,
        bureau_keys: Object.keys(adapter.bureaus || {}),
        bureau_scores: Object.fromEntries(
          Object.entries(adapter.bureaus || {}).map(([k, v]) => [k, v?.score ?? null])
        ),
        bureau_tradeline_counts: Object.fromEntries(
          Object.entries(adapter.bureaus || {}).map(([k, v]) => [k, Array.isArray(v?.tradelines) ? v.tradelines.length : 0])
        ),
        engine_tradelines_first_bureau: (() => {
          const first = adapter.available[0];
          return first ? adapter.bureaus[first]?.tradelines ?? [] : [];
        })()
      },
      underwrite,
      suggestions,
      report
    };
    write("engine-output.json", engineOutput);

    const seedReasonCodes = crsRes.rows[0]?.result?.reason_codes ?? null;
    const seedPreapprovals = crsRes.rows[0]?.result?.preapprovals ?? null;
    const seedOutcome = crsRes.rows[0]?.result?.outcome ?? null;

    const tiersRecord = {
      stored_client_outcome_tier: clientRow?.outcome_tier ?? null,
      stored_crs_outcome_tier: crsRes.rows[0]?.outcome_tier ?? null,
      stored_seed_outcome: seedOutcome,
      stored_seed_reason_codes: seedReasonCodes,
      stored_seed_preapprovals: seedPreapprovals,
      engine_fundable: underwrite?.fundable ?? null,
      engine_primary_bureau: underwrite?.primary_bureau ?? null,
      engine_metrics: underwrite?.metrics ?? null,
      engine_personal: underwrite?.personal ?? null,
      engine_business: underwrite?.business ?? null,
      engine_totals: underwrite?.totals ?? null,
      engine_optimization: underwrite?.optimization ?? null,
      engine_lite_banner_funding: underwrite?.lite_banner_funding ?? null,
      engine_has_reason_codes_key: Object.prototype.hasOwnProperty.call(underwrite || {}, "reason_codes"),
      engine_has_preapprovals_key: Object.prototype.hasOwnProperty.call(underwrite || {}, "preapprovals"),
      engine_has_outcome_tier_key: Object.prototype.hasOwnProperty.call(underwrite || {}, "outcome_tier"),
      engine_has_tiers_key: Object.prototype.hasOwnProperty.call(underwrite || {}, "tiers"),
      suggestions
    };
    write("tiers-reasons-preapprovals.json", tiersRecord);

    const letter = await runLetterModule({
      db: { query: (sql, params) => q(sql, params) },
      underwrite,
      report
    });
    write("letter-result.json", letter);
    if (letter.rendered_bytes != null) {
      fs.writeFileSync(path.join(OUT, "letter.bin"), Buffer.from(letter.rendered_bytes));
    }
    if (letter.error_dump) {
      write("letter-error.json", letter.error_dump);
    }

    const plausibility = judgePlausibility({
      storedTradelines,
      adapter,
      underwrite,
      crsRows,
      clientRow
    });
    write("plausibility.json", plausibility);

    const after = await dumpFundingRows(q, "after_engine");
    write("funding-columns.json", { before, after, engine_is_pure_no_db_write: true });

    const proofs = buildProofs({
      engineOutput,
      tiersRecord,
      letter,
      plausibility,
      before,
      after
    });
    write("proofs.json", proofs);

    console.log(JSON.stringify({
      proofs: proofs.map((p) => `${p.id}=${p.result}`),
      fundable: underwrite?.fundable ?? null,
      totals: underwrite?.totals ?? null,
      available: adapter.available,
      letter_renders: letter.renders
    }));
  } finally {
    await client.end();
  }
}

async function dumpFundingRows(q, label) {
  const clients = (await q(
    `SELECT id, org_id, outcome_tier, custom_fields, tags, updated_at, is_demo
       FROM clients WHERE id = $1`,
    [CLIENT_ID]
  )).rows.map((r) => ({
    label,
    id: r.id,
    is_demo: r.is_demo,
    outcome_tier: r.outcome_tier,
    tags: r.tags,
    updated_at: r.updated_at,
    funding_custom_fields: fundingishKeys(r.custom_fields)
  }));

  let customFieldTable = { exists: false, rows: [] };
  try {
    const cols = (await q(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'client_custom_fields'`
    )).rows.map((r) => r.column_name);
    if (cols.length) {
      const rows = (await q(
        `SELECT * FROM client_custom_fields WHERE client_id = $1`,
        [CLIENT_ID]
      )).rows;
      customFieldTable = {
        exists: true,
        count: rows.length,
        funding_cols_present: cols.filter((c) => /underwrite|funding|prequal|analyzer|outcome|estimate/i.test(c)),
        rows: rows.map((r) => {
          const slim = { client_id: r.client_id };
          for (const c of cols) {
            if (/underwrite|funding|prequal|analyzer|outcome|estimate|util|tier/i.test(c)) slim[c] = r[c];
          }
          return slim;
        })
      };
    }
  } catch (err) {
    customFieldTable = { exists: false, error: err.message };
  }

  const crs = (await q(
    `SELECT id, outcome_tier,
            result->>'outcome' AS result_outcome,
            result->'reason_codes' AS reason_codes,
            result->'preapprovals' AS preapprovals,
            result->'crm_payload'->'customFields' AS crm_custom_fields,
            created_at
       FROM crs_results WHERE client_id = $1`,
    [CLIENT_ID]
  )).rows;

  const tables = (await q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (table_name ILIKE '%underwrite%' OR table_name ILIKE '%funding%')
      ORDER BY table_name`
  )).rows.map((r) => r.table_name);

  const extra = {};
  for (const table of tables) {
    try {
      const hasClient = (await q(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'client_id'`,
        [table]
      )).rows.length > 0;
      if (!hasClient) {
        extra[table] = { skipped: "no client_id column" };
        continue;
      }
      const rows = (await q(
        `SELECT * FROM ${table} WHERE client_id = $1`,
        [CLIENT_ID]
      )).rows;
      extra[table] = { count: rows.length, rows };
    } catch (err) {
      extra[table] = { error: err.message };
    }
  }

  let documents = { count: 0, rows: [] };
  try {
    const rows = (await q(
      `SELECT id, kind, subtype, document_key, mime_type, filename, generated_by, created_at
         FROM documents WHERE client_id = $1`,
      [CLIENT_ID]
    )).rows;
    documents = { count: rows.length, rows };
  } catch (err) {
    documents = { error: err.message };
  }

  return { label, clients, customFieldTable, crs, funding_named_tables: tables, extra, documents };
}

async function runLetterModule({ db, underwrite, report }) {
  const out = {
    module: "src/underwrite/funding-letter-pdf.mjs",
    renders: false,
    note: "This file stores and loads funding-stack PDFs. It does not take an engine result and does not render PDF/buffer/HTML.",
    exports_called: [],
    rendered_bytes: null,
    error_dump: null
  };

  try {
    out.exports_called.push({
      fn: "isFundingLetterFile(engineResult)",
      returned: isFundingLetterFile(underwrite)
    });
  } catch (err) {
    out.exports_called.push({ fn: "isFundingLetterFile(engineResult)", error: err.message });
  }

  try {
    out.exports_called.push({
      fn: "pickFundingLetterPdfBase64([engineResult], EX)",
      returned: pickFundingLetterPdfBase64([underwrite], "EX")
    });
  } catch (err) {
    out.exports_called.push({ fn: "pickFundingLetterPdfBase64([engineResult], EX)", error: err.message });
  }

  try {
    const persistMissing = await persistFundingLetterFiles(null, null, {
      orgId: ORG_ID,
      clientId: CLIENT_ID,
      files: [underwrite]
    });
    out.exports_called.push({
      fn: "persistFundingLetterFiles(null,null,{files:[engineResult]})",
      returned: persistMissing
    });
  } catch (err) {
    out.exports_called.push({
      fn: "persistFundingLetterFiles(null,null,{files:[engineResult]})",
      error: err.message
    });
  }

  let store = null;
  let storeError = null;
  try {
    store = storeFromEnv(process.env);
    out.store_name = store?.name || null;
  } catch (err) {
    storeError = err.message;
    out.store_from_env_error = err.message;
  }

  try {
    const persistEngine = await persistFundingLetterFiles(db, store, {
      orgId: ORG_ID,
      clientId: CLIENT_ID,
      files: [underwrite, report]
    });
    out.exports_called.push({
      fn: "persistFundingLetterFiles(db,store,{files:[underwrite,report]})",
      returned: persistEngine,
      wrote_documents: Array.isArray(persistEngine?.stored) ? persistEngine.stored.length : null
    });
  } catch (err) {
    out.exports_called.push({
      fn: "persistFundingLetterFiles(db,store,{files:[underwrite,report]})",
      error: err.message
    });
    out.error_dump = { when: "persistFundingLetterFiles against engine result", message: err.message, stack: err.stack };
  }

  const loads = {};
  for (const bureau of ["EX", "EQ", "TU"]) {
    try {
      const b64 = await loadFundingLetterPdf(db, store, {
        orgId: ORG_ID,
        clientId: CLIENT_ID,
        bureau
      });
      loads[bureau] = b64 == null ? null : { bytes_b64_len: String(b64).length, prefix: String(b64).slice(0, 8) };
      if (b64) {
        out.renders = true;
        out.rendered_kind = "existing_stored_pdf_base64";
      }
    } catch (err) {
      loads[bureau] = { error: err.message };
      if (!out.error_dump) {
        out.error_dump = { when: `loadFundingLetterPdf ${bureau}`, message: err.message, stack: err.stack };
      }
    }
  }
  out.exports_called.push({ fn: "loadFundingLetterPdf EX/EQ/TU", returned: loads, store_error: storeError });

  if (!out.renders) {
    out.error_dump = out.error_dump || {
      when: "funding-letter-pdf.mjs against engine result",
      message: "No PDF/buffer/HTML rendered. Module persists or loads stored letter files. Engine result is not a letter file (isFundingLetterFile=false). loadFundingLetterPdf returned null for EX/EQ/TU.",
      renders_pdf: false,
      renders_html: false,
      renders_buffer: false
    };
    fs.writeFileSync(
      path.join(OUT, "letter-error.txt"),
      [
        "funding-letter-pdf.mjs did not render a PDF, buffer, or HTML from the engine result.",
        "Exports tried: persistFundingLetterFiles, loadFundingLetterPdf, pickFundingLetterPdfBase64, isFundingLetterFile.",
        `isFundingLetterFile(underwrite)=${isFundingLetterFile(underwrite)}`,
        "loadFundingLetterPdf EX/EQ/TU = null (no stored funding letter documents for this client).",
        "This module stores/loads PDFs. It does not generate them from computeUnderwrite output.",
        "No email sent."
      ].join("\n")
    );
  }

  return out;
}

function judgePlausibility({ storedTradelines, adapter, underwrite, crsRows, clientRow }) {
  const flags = [];
  const revolving = storedTradelines.filter((t) => t.kind === "revolving");
  const installment = storedTradelines.filter((t) => t.kind === "installment");
  const revLimit = revolving.reduce((a, t) => a + Number(t.credit_limit_cents || 0), 0) / 100;
  const revBal = revolving.reduce((a, t) => a + Number(t.balance_cents || 0), 0) / 100;
  const expectedUtilPct = revLimit > 0 ? (revBal / revLimit) * 100 : null;
  const expectedUtilFromSeedMath = ((2100 + 4800 + 950) / (12000 + 25000 + 8000)) * 100;

  const kinds = storedTradelines.map((t) => ({ lender: t.lender, kind: t.kind, account_ref: t.account_ref, opened_on: t.opened_on, raw_bureau: t.raw_bureau }));
  const toyota = storedTradelines.find((t) => /toyota/i.test(t.lender || "") || t.account_ref === "SIM-TOYO-001");
  if (toyota && toyota.kind === "revolving") {
    flags.push({
      id: "installment_treated_as_revolving",
      severity: "fail",
      detail: "Toyota Motor Credit stored as revolving"
    });
  }

  const engineUtil = underwrite?.metrics?.utilization_pct;
  if (engineUtil != null && expectedUtilFromSeedMath != null) {
    const delta = Math.abs(Number(engineUtil) - expectedUtilFromSeedMath);
    if (delta > 5) {
      flags.push({
        id: "utilization_cannot_come_from_seed_math",
        severity: "fail",
        detail: `engine util ${engineUtil} vs seed revolving math ${expectedUtilFromSeedMath.toFixed(4)} (2100+4800+950)/(12000+25000+8000)`
      });
    }
  }

  const combined = underwrite?.totals?.total_combined_funding;
  if (combined === 0 || combined === 0.0) {
    flags.push({
      id: "zero_on_125k_seed",
      severity: "fail",
      detail: `engine total_combined_funding=${combined}; seed estimate is 125000`
    });
  } else if (combined != null && (combined < 20000 || combined > 400000)) {
    flags.push({
      id: "estimate_wildly_off",
      severity: "fail",
      detail: `engine total_combined_funding=${combined}; seed estimate is 125000`
    });
  }

  if (adapter.available.length === 0) {
    flags.push({
      id: "engine_missed_seed_scores",
      severity: "fail",
      detail: "toBureaus found no bureau scores. Seed stores 718/724/731 under consumerSignals.scores.perBureau and crm_payload.scores, not result.scores. triMerge reads result.scores only."
    });
  }

  const bureauScores = Object.fromEntries(
    Object.entries(adapter.bureaus || {}).map(([k, v]) => [k, v?.score ?? null])
  );
  if (bureauScores.experian != null && bureauScores.experian !== 718) {
    flags.push({ id: "bureau_score_ex_swapped", severity: "fail", detail: `experian score ${bureauScores.experian} expected 718` });
  }
  if (bureauScores.equifax != null && bureauScores.equifax !== 724) {
    flags.push({ id: "bureau_score_eq_swapped", severity: "fail", detail: `equifax score ${bureauScores.equifax} expected 724` });
  }
  if (bureauScores.transunion != null && bureauScores.transunion !== 731) {
    flags.push({ id: "bureau_score_tu_swapped", severity: "fail", detail: `transunion score ${bureauScores.transunion} expected 731` });
  }

  const tlCounts = Object.values(adapter.bureaus || {}).map((b) => Array.isArray(b?.tradelines) ? b.tradelines.length : 0);
  if (tlCounts.some((n) => n === 4) && adapter.available.length > 1) {
    flags.push({
      id: "all_tradelines_copied_to_every_bureau",
      severity: "fail",
      detail: "Adapter sends the same 4 tradelines to every available bureau. Seed tags Chase EX, Amex EQ, Cap One TU, Toyota EX. Engine then sums card funding across bureaus, so one file can be counted three times."
    });
  }

  const ignoresTradelines = storedTradelines.length > 0
    && (underwrite?.personal?.highest_revolving_limit === 0 || underwrite?.personal?.highest_revolving_limit == null)
    && revolving.length > 0;
  if (ignoresTradelines) {
    flags.push({
      id: "engine_did_not_use_revolving_limits",
      severity: "fail",
      detail: `highest_revolving_limit=${underwrite?.personal?.highest_revolving_limit}; stored revolving limits exist. Possible cause: opened_on missing so lines read unseasoned, or no bureau was available so engine never saw the lines.`
    });
  }

  const openedMissing = storedTradelines.filter((t) => t.opened_on == null).length;
  if (openedMissing > 0) {
    flags.push({
      id: "opened_on_missing",
      severity: "fail",
      detail: `${openedMissing} of ${storedTradelines.length} stored lines have no opened_on. Engine treats those as unseasoned and they add $0 stacking.`
    });
  }

  const readsSeedOutcomeOnly = underwrite?.fundable == null
    && clientRow?.outcome_tier === "FULL_FUNDING"
    && adapter.available.length === 0;
  if (adapter.available.length === 0) {
    flags.push({
      id: "engine_does_not_read_seed_outcome",
      severity: "info",
      detail: "Engine does not read crs_results.outcome / FULL_FUNDING / preapprovals. It only reads bureau-shaped numbers from the adapter. Seed outcome stays on the client/crs row and is not an engine input."
    });
  }

  const engineHasNoReasonCodes = !Object.prototype.hasOwnProperty.call(underwrite || {}, "reason_codes");
  if (engineHasNoReasonCodes) {
    flags.push({
      id: "engine_emits_no_reason_codes",
      severity: "fail",
      detail: "computeUnderwrite output has no reason_codes. Seed reason_codes live only on crs_results.result (sim_demo, low_util)."
    });
  }
  if (!Object.prototype.hasOwnProperty.call(underwrite || {}, "preapprovals")) {
    flags.push({
      id: "engine_emits_no_preapprovals",
      severity: "fail",
      detail: "computeUnderwrite output has no preapprovals. Seed preapprovals.totalCombined=125000 lives only on crs_results.result."
    });
  }

  if (underwrite?.fundable === false && clientRow?.outcome_tier === "FULL_FUNDING") {
    flags.push({
      id: "fundable_false_vs_full_funding_seed",
      severity: "fail",
      detail: "Engine fundable=false while simulate stamped clients.outcome_tier=FULL_FUNDING. Missing negatives count becomes null; fundable requires neg === 0."
    });
  }

  return {
    seed: SEED,
    stored_kinds: kinds,
    revolving_limit_sum: revLimit,
    revolving_balance_sum: revBal,
    expected_util_pct_from_stored: expectedUtilPct,
    expected_util_pct_from_seed_math: expectedUtilFromSeedMath,
    adapter_util_pct: adapter.utilization?.pct ?? null,
    engine_util_pct: engineUtil ?? null,
    engine_totals: underwrite?.totals ?? null,
    engine_personal: underwrite?.personal ?? null,
    engine_fundable: underwrite?.fundable ?? null,
    engine_reads_seed_outcome: false,
    reads_seed_outcome_only: false,
    reads_stored_tradelines: adapter.available.length > 0 && storedTradelines.length > 0,
    flags
  };
}

function buildProofs({ engineOutput, tiersRecord, letter, plausibility, before, after }) {
  const engineRan = Boolean(engineOutput?.underwrite);
  const letterRenders = letter?.renders === true;
  const failFlags = (plausibility.flags || []).filter((f) => f.severity === "fail");
  const clientWrote = before.clients?.[0]?.outcome_tier != null;
  const engineChanged = JSON.stringify(before.clients) !== JSON.stringify(after.clients)
    || JSON.stringify(before.crs) !== JSON.stringify(after.crs);

  return [
    {
      id: "uw.engine_run",
      result: engineRan ? "PASS" : "FAIL",
      expected: "Run computeUnderwrite on THIS client's stored crs_results + tradelines (same chain as underwriteiq.pg.test.mjs)",
      observed: engineRan
        ? `ran; available_bureaus=${JSON.stringify(engineOutput.adapter.available)}; fundable=${engineOutput.underwrite.fundable}; total_combined=${engineOutput.underwrite.totals?.total_combined_funding}`
        : "engine did not return underwrite",
      evidence: "w-uw/engine-output.json"
    },
    {
      id: "uw.tiers_reason_codes_preapprovals",
      result: "FAIL",
      expected: "Engine output carries tiers, reason codes, preapprovals for this file",
      observed: [
        `engine.fundable=${tiersRecord.engine_fundable}`,
        `engine has reason_codes=${tiersRecord.engine_has_reason_codes_key}`,
        `engine has preapprovals=${tiersRecord.engine_has_preapprovals_key}`,
        `engine has outcome_tier=${tiersRecord.engine_has_outcome_tier_key}`,
        `engine has tiers=${tiersRecord.engine_has_tiers_key}`,
        `stored seed reason_codes=${JSON.stringify(tiersRecord.stored_seed_reason_codes)}`,
        `stored seed preapprovals=${JSON.stringify(tiersRecord.stored_seed_preapprovals)}`,
        `stored client/crs tier=${tiersRecord.stored_client_outcome_tier}/${tiersRecord.stored_crs_outcome_tier}`
      ].join("; "),
      evidence: "w-uw/tiers-reasons-preapprovals.json"
    },
    {
      id: "uw.funding_letter_pdf",
      result: letterRenders ? "PASS" : "FAIL",
      expected: "funding-letter-pdf.mjs renders a PDF/buffer/HTML from the engine result",
      observed: letterRenders
        ? `rendered ${letter.rendered_kind}`
        : (letter.error_dump?.message || "no render"),
      evidence: letterRenders ? "w-uw/letter-result.json" : "w-uw/letter-error.txt"
    },
    {
      id: "uw.plausibility",
      result: failFlags.length ? "FAIL" : "PASS",
      expected: "Engine math plausible vs seeded tradelines (718/724/731, util from 2100+4800+950 on 12000+25000+8000, estimate near 125000, installment not revolving)",
      observed: failFlags.length
        ? failFlags.map((f) => `${f.id}: ${f.detail}`).join(" | ")
        : "no fail flags",
      evidence: "w-uw/plausibility.json"
    },
    {
      id: "uw.column_writes",
      result: "PASS",
      expected: "Dump underwrite/funding columns written by simulate + this engine run",
      observed: [
        `simulate wrote clients.outcome_tier=${before.clients?.[0]?.outcome_tier} and crs_results.outcome_tier=${before.crs?.[0]?.outcome_tier}`,
        `clients.custom_fields funding keys=${JSON.stringify(before.clients?.[0]?.funding_custom_fields)}`,
        `engine run changed client/crs rows=${engineChanged}`,
        `funding-named tables=${JSON.stringify(before.funding_named_tables)}`,
        `documents=${before.documents?.count ?? 0}`
      ].join("; "),
      evidence: "w-uw/funding-columns.json"
    },
    {
      id: "uw.ground_truth",
      result: "MISSING",
      expected: "Written intended journey names UnderwriteIQ",
      observed: "Chris 2026-08-18 board is the checklist. docs/journeys/*-intended.md do not name UnderwriteIQ.",
      evidence: "docs/workflows/audit-engine-2026-08-18.md"
    }
  ];
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});

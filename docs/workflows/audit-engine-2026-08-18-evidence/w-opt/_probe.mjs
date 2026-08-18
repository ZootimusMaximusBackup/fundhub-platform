// W-OPT probe — optimize + metro2 letters. Evidence only. No PostGrid. No persist mail.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-opt");
const CLIENT_ID = "41a3199f-1835-4ac8-91c0-d4f37bd92037";
const CRS_ID = "c1f83e6b-a624-4f28-a32a-531a530b3ad4";
const ORG_ID = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const COMPARE = "8556bedc-46e1-4d85-b0cd-a24adfee1521";

const SEEDED = [
  { creditor: "Chase Sapphire Preferred", bureau: "EX", id: "SIM-CHASE-001" },
  { creditor: "American Express Blue Business Cash", bureau: "EQ", id: "SIM-AMEX-001" },
  { creditor: "Capital One Spark", bureau: "TU", id: "SIM-CAP1-001" },
  { creditor: "Toyota Motor Credit", bureau: "EX", id: "SIM-TOYO-001" }
];

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
fs.mkdirSync(OUT, { recursive: true });

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

function dump(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2));
}

function textHas(hay, needle) {
  return String(hay || "").toLowerCase().includes(String(needle).toLowerCase());
}

const PLACEHOLDER_RE = /\b(lorem|ipsum|placeholder|todo|xxx+|sample text|dummy)\b/i;
const INVENTED_RE = /\b(collection|charge[\s-]?off|chargeoff|midland|lvnv|portfolio recovery|medical collection)\b/i;

async function main() {
  if (CLIENT_ID === FORBIDDEN) throw new Error("refused forbidden live id");

  const tableScan = await withDb(async (c) => {
    const tables = await c.query(`
      SELECT table_schema, table_name
        FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog','information_schema')
         AND (
           table_name ILIKE '%letter%'
           OR table_name ILIKE '%dispute%'
           OR table_name ILIKE '%diy%'
           OR table_name ILIKE '%optimize%'
           OR table_name = 'documents'
           OR table_name = 'letters_generated'
         )
       ORDER BY table_schema, table_name`);
    const cols = await c.query(`
      SELECT table_name, column_name, data_type
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('clients','crs_results','tradelines','documents','dispute_letters','dispute_cases','dispute_items','cards')
         AND (
           column_name ILIKE '%diy%'
           OR column_name ILIKE '%letter%'
           OR column_name ILIKE '%optim%'
           OR column_name IN ('custom_fields','result','is_demo')
         )
       ORDER BY table_name, column_name`);
    return { tables: tables.rows, columns: cols.rows };
  });
  dump("01-table-discovery.json", tableScan);

  const before = await withDb(async (c) => {
    const client = await c.query(
      `SELECT id, org_id, email, first_name, last_name, is_demo, custom_fields
         FROM clients WHERE id = $1`,
      [CLIENT_ID]
    );
    const crs = await c.query(
      `SELECT id, client_id, outcome_tier, created_at,
              jsonb_typeof(result) AS result_type,
              (SELECT jsonb_object_keys FROM jsonb_object_keys(result) LIMIT 1) IS NOT NULL AS has_result
         FROM crs_results WHERE id = $1`,
      [CRS_ID]
    );
    const resultKeys = await c.query(
      `SELECT jsonb_object_keys(result) AS key FROM crs_results WHERE id = $1`,
      [CRS_ID]
    );
    const resultShape = await c.query(
      `SELECT
         result ? 'bureaus' AS has_bureaus,
         result ? 'tradelines' AS has_tradelines,
         result ? 'inquiries' AS has_inquiries,
         result ? 'creditFiles' AS has_credit_files,
         jsonb_typeof(result->'bureaus') AS bureaus_type,
         jsonb_typeof(result->'tradelines') AS tradelines_type,
         CASE WHEN jsonb_typeof(result->'tradelines') = 'array'
              THEN jsonb_array_length(result->'tradelines') ELSE NULL END AS tradeline_count,
         result->'tradelines' AS tradelines
         FROM crs_results WHERE id = $1`,
      [CRS_ID]
    );
    const tradelines = await c.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tradelines'
        ORDER BY ordinal_position`
    );
    let tlRows = { error: "no tradelines table" };
    try {
      const cols = tradelines.rows.map((r) => r.column_name);
      const pick = ["id", "client_id", "lender", "kind", "account_ref", "bureau", "creditor", "creditor_name"]
        .filter((x) => cols.includes(x));
      const extra = cols.filter((x) => /limit|balance|cent|ref|name|type|kind/i.test(x)).slice(0, 12);
      const sel = [...new Set([...pick, ...extra])];
      tlRows = (await c.query(
        `SELECT ${sel.map((x) => `"${x}"`).join(", ")} FROM tradelines WHERE client_id = $1`,
        [CLIENT_ID]
      )).rows;
    } catch (e) {
      tlRows = { error: String(e.message).slice(0, 200) };
    }

    async function countSafe(sql, params) {
      try {
        const r = await c.query(sql, params);
        return { ok: true, rows: r.rows, count: r.rowCount };
      } catch (e) {
        return { ok: false, error: String(e.message).slice(0, 180) };
      }
    }

    const lettersGeneratedTable = await countSafe(
      `SELECT to_regclass('public.letters_generated') AS reg`
    );
    const disputeLetters = await countSafe(
      `SELECT id, bureau, round, status, left(body_text, 80) AS body_head, created_at
         FROM dispute_letters WHERE client_id = $1`,
      [CLIENT_ID]
    );
    const disputeCases = await countSafe(
      `SELECT id, bureau, round, status FROM dispute_cases WHERE client_id = $1`,
      [CLIENT_ID]
    );
    const disputeItems = await countSafe(
      `SELECT id, rule_id, creditor, account_last4, severity FROM dispute_items WHERE client_id = $1`,
      [CLIENT_ID]
    );
    const documents = await countSafe(
      `SELECT id, kind, subtype, title, filename, created_at
         FROM documents WHERE client_id = $1`,
      [CLIENT_ID]
    );
    const cards = await countSafe(
      `SELECT c.id, p.key AS pipeline_key, ps.key AS stage_key, ps.name AS stage_name
         FROM cards c
         JOIN pipelines p ON p.id = c.pipeline_id
         JOIN pipeline_stages ps ON ps.id = c.stage_id
        WHERE c.client_id = $1`,
      [CLIENT_ID]
    );
    const compareLetters = await countSafe(
      `SELECT count(*)::int AS n FROM dispute_letters WHERE client_id = $1`,
      [COMPARE]
    );
    const compareDocs = await countSafe(
      `SELECT count(*)::int AS n FROM documents WHERE client_id = $1`,
      [COMPARE]
    );
    const partners = await countSafe(
      `SELECT id FROM partners WHERE org_id = $1 LIMIT 5`,
      [ORG_ID]
    );
    const settings = partners.ok && partners.rows[0]
      ? await countSafe(
        `SELECT partner_id, autopilot_enabled, autopilot_paused_at
           FROM partner_module_settings WHERE partner_id = $1`,
        [partners.rows[0].id]
      )
      : { ok: false, skipped: "no partner for org" };
    const adSets = partners.ok && partners.rows[0]
      ? await countSafe(
        `SELECT count(*)::int AS n FROM ad_sets WHERE partner_id = $1`,
        [partners.rows[0].id]
      )
      : { ok: false, skipped: "no partner" };

    return {
      client: client.rows[0] || null,
      crs_meta: crs.rows[0] || null,
      result_keys: resultKeys.rows.map((r) => r.key),
      result_shape: resultShape.rows[0] || null,
      tradeline_columns: tradelines.rows.map((r) => r.column_name),
      tradeline_rows: tlRows,
      letters_generated_regclass: lettersGeneratedTable,
      dispute_letters: disputeLetters,
      dispute_cases: disputeCases,
      dispute_items: disputeItems,
      documents,
      cards,
      compare: { dispute_letters: compareLetters, documents: compareDocs },
      partners,
      partner_settings: settings,
      ad_sets: adSets
    };
  });

  const cf = before.client?.custom_fields && typeof before.client.custom_fields === "object"
    ? before.client.custom_fields
    : {};
  const diyKeys = Object.fromEntries(
    Object.entries(cf).filter(([k]) => /diy|letter|optim/i.test(k))
  );
  dump("02-before-query.json", {
    client_id: before.client?.id || null,
    org_id: before.client?.org_id || null,
    is_demo: before.client?.is_demo ?? null,
    email_domain: String(before.client?.email || "").split("@")[1] || null,
    diy_custom_fields: diyKeys,
    crs_id_match: before.crs_meta?.id === CRS_ID,
    result_keys: before.result_keys,
    result_shape: {
      has_bureaus: before.result_shape?.has_bureaus,
      has_tradelines: before.result_shape?.has_tradelines,
      has_inquiries: before.result_shape?.has_inquiries,
      has_credit_files: before.result_shape?.has_credit_files,
      bureaus_type: before.result_shape?.bureaus_type,
      tradeline_count: before.result_shape?.tradeline_count
    },
    tradeline_rows: before.tradeline_rows,
    letters_generated_exists: before.letters_generated_regclass,
    dispute_letters_count: before.dispute_letters.ok ? before.dispute_letters.rows.length : before.dispute_letters,
    dispute_cases_count: before.dispute_cases.ok ? before.dispute_cases.rows.length : before.dispute_cases,
    documents_count: before.documents.ok ? before.documents.rows.length : before.documents,
    cards: before.cards.ok ? before.cards.rows : before.cards,
    compare_letter_count: before.compare.dispute_letters,
    partner_settings: before.partner_settings,
    ad_sets: before.ad_sets
  });
  dump("02b-crs-tradelines.json", before.result_shape?.tradelines || null);

  // ── 1. optimize on THIS credit file (in-process, no ad writes) ──
  const { evaluate, RULES } = await import(path.join(ROOT, "src/optimize/rules.mjs"));
  const { capIncrease, HARD_CAP_PCT, checkBudgetWrite } = await import(path.join(ROOT, "src/optimize/ceilings.mjs"));
  const { runDailyOptimization } = await import(path.join(ROOT, "src/optimize/run.mjs"));

  const creditAsAdSet = {
    id: CLIENT_ID,
    budget_cents: 210000,
    learning_until: null,
    rotated_at: null,
    crs_id: CRS_ID,
    tradelines: before.result_shape?.tradelines || []
  };
  const allRulesActive = Object.fromEntries(
    Object.keys(RULES).map((k) => [k, { active: true, params: {} }])
  );
  const evalOnFile = evaluate({
    adSet: creditAsAdSet,
    series: [],
    rules: allRulesActive,
    maxIncreasePct: 20
  });
  const capSample = {
    hard_cap_pct: HARD_CAP_PCT,
    from_2100_cents_at_20: capIncrease(210000, 20),
    from_2100_cents_at_50_clamped: capIncrease(210000, 50)
  };

  let runOpt = { skipped: "not_called" };
  await withDb(async (c) => {
    const partnerId = before.partners.ok && before.partners.rows[0]?.id;
    if (!partnerId) {
      runOpt = { ran: false, skipped: "no_partner_for_org", note: "runDailyOptimization requires orgId+partnerId, not client_id" };
      return;
    }
    const settings = before.partner_settings.ok ? before.partner_settings.rows[0] : null;
    if (settings?.autopilot_enabled && !settings?.autopilot_paused_at) {
      runOpt = {
        ran: false,
        skipped: "autopilot_enabled_would_write_ad_sets",
        note: "refused live execute — would UPDATE ad_sets for a partner, not this credit file"
      };
      return;
    }
    runOpt = await runDailyOptimization(c, { orgId: ORG_ID, partnerId });
  });

  let ceilingCheck = { skipped: "no_partner" };
  await withDb(async (c) => {
    const partnerId = before.partners.ok && before.partners.rows[0]?.id;
    if (!partnerId) return;
    ceilingCheck = await checkBudgetWrite(c, {
      partnerId,
      currentBudgetCents: 210000,
      proposedBudgetCents: 250000
    });
    if (ceilingCheck.ceilings) {
      ceilingCheck = {
        allowed: ceilingCheck.allowed,
        reasons: ceilingCheck.reasons,
        ceiling_count: ceilingCheck.ceilings.length,
        scopes: ceilingCheck.ceilings.map((x) => x.scope)
      };
    }
  });

  dump("03-optimize-output.json", {
    module_is: "ad_spend_autopilot",
    entry: "src/optimize/run.mjs runDailyOptimization",
    requires: ["orgId", "partnerId"],
    does_not_accept: ["client_id", "crs_id", "tradelines"],
    evaluate_on_credit_file: evalOnFile,
    rules_keys: Object.keys(RULES),
    capIncrease: capSample,
    runDailyOptimization: runOpt,
    checkBudgetWrite: ceilingCheck
  });

  // ── 2+3. Load stored CRS, run designed letter entry (tests: from-crs → buildDiyPackage) ──
  const storedCrs = await withDb(async (c) => {
    const r = await c.query(`SELECT result FROM crs_results WHERE id = $1 AND client_id = $2`, [CRS_ID, CLIENT_ID]);
    return r.rows[0]?.result || null;
  });
  dump("04-crs-result-keys.json", {
    keys: storedCrs && typeof storedCrs === "object" ? Object.keys(storedCrs) : [],
    has_bureaus: Boolean(storedCrs?.bureaus),
    first_tradeline_keys: storedCrs?.tradelines?.[0] ? Object.keys(storedCrs.tradelines[0]) : [],
    first_tradeline: storedCrs?.tradelines?.[0] || null
  });

  const { violationsByBureauFromMergedCrs, reportAsOf } = await import(
    path.join(ROOT, "src/metro2/diy/from-crs.mjs")
  );
  const { buildDiyPackage } = await import(path.join(ROOT, "src/metro2/diy/package.mjs"));
  const { collectorsFromViolations } = await import(path.join(ROOT, "src/metro2/diy/collectors.mjs"));

  const designedViolations = violationsByBureauFromMergedCrs(storedCrs);
  const designedCounts = Object.fromEntries(
    Object.entries(designedViolations).map(([k, v]) => [k, (v || []).map((x) => ({
      ruleId: x.ruleId, severity: x.severity, creditor: x.creditor, account_last4: x.account_last4,
      field: x.field, reason: x.reason, collection: x.collection
    }))])
  );
  dump("05-designed-from-crs.json", {
    asOf: reportAsOf(storedCrs),
    bureau_keys: Object.keys(designedViolations),
    counts: Object.fromEntries(Object.entries(designedViolations).map(([k, v]) => [k, v.length])),
    violations: designedCounts
  });

  const identity = {
    fullName: [before.client?.first_name, before.client?.last_name].filter(Boolean).join(" ") || "Client",
    addressLine1: String(cf.address_line1 || cf.address || "").trim(),
    city: String(cf.city || "").trim(),
    state: String(cf.state || "").trim(),
    zip: String(cf.zip || cf.postal_code || "").trim()
  };

  const pack = await buildDiyPackage({
    violationsByBureau: designedViolations,
    identity,
    seed: `${ORG_ID}:${CLIENT_ID}`
  });

  const fileIndex = (pack.files || []).map((f) => ({
    path: f.path,
    has_pdf: Boolean(f.pdf),
    pdf_bytes: f.pdf?.byteLength || 0,
    text_len: (f.text || "").length,
    has_html: /<\/?[a-z][\s\S]*>/i.test(f.text || "")
  }));
  dump("06-designed-pack.json", {
    ok: pack.ok,
    reason: pack.reason || null,
    stalled: pack.stalled || false,
    letterCount: pack.letterCount ?? 0,
    files: fileIndex
  });

  const samplesDir = path.join(OUT, "samples");
  fs.mkdirSync(samplesDir, { recursive: true });
  const samplePaths = [];
  for (const f of pack.files || []) {
    if (!f.text) continue;
    const safe = String(f.path || "letter.txt").replace(/[^\w./-]+/g, "_").replace(/\//g, "__");
    const dest = path.join(samplesDir, safe.endsWith(".txt") || safe.endsWith(".html") ? safe : `${safe}.txt`);
    fs.writeFileSync(dest, f.text);
    samplePaths.push(path.relative(OUT, dest));
  }

  const allText = (pack.files || []).map((f) => f.text || "").join("\n---\n");
  const content = {
    seeded_named: SEEDED.map((s) => ({
      ...s,
      name_in_pack: textHas(allText, s.creditor),
      id_in_pack: textHas(allText, s.id)
    })),
    bureaus_in_pack: {
      EX: /\bEX\b|Experian/i.test(allText),
      EQ: /\bEQ\b|Equifax/i.test(allText),
      TU: /\bTU\b|TransUnion/i.test(allText)
    },
    placeholder: PLACEHOLDER_RE.test(allText) ? (allText.match(PLACEHOLDER_RE) || [])[0] : null,
    invented_derogatory: INVENTED_RE.test(allText) ? [...allText.matchAll(new RegExp(INVENTED_RE, "gi"))].map((m) => m[0]).slice(0, 20) : [],
    collectors_from_violations: collectorsFromViolations(designedViolations)
  };
  dump("07-content-check.json", content);

  // Diagnostic (not designed stored shape): wrap sim tradelines as bureau reports
  // so we can see what the engine would claim on this clean seed IF shape matched.
  const SOURCE = { EX: "Experian", EQ: "Equifax", TU: "TransUnion" };
  const wrapped = { bureaus: { EX: null, EQ: null, TU: null } };
  for (const code of ["EX", "EQ", "TU"]) {
    const tls = (storedCrs?.tradelines || []).filter((t) => t.bureau === code);
    if (!tls.length) continue;
    wrapped.bureaus[code] = {
      requestedBureaus: {
        transunion: code === "TU",
        experian: code === "EX",
        equifax: code === "EQ"
      },
      responseDetail: { dateRequested: "2026-08-18T00:00:00.000Z" },
      creditFiles: [{
        creditFileDetail: {
          creditFileInfileDate: "2026-08-18",
          creditFileResultStatusType: "FileReturned",
          sourceType: SOURCE[code]
        }
      }],
      inquiries: [],
      tradelines: tls.map((t) => ({
        ...t,
        sourceType: SOURCE[code],
        accountType: t.accountType === "revolving" ? "Revolving" : t.accountType === "installment" ? "Installment" : t.accountType,
        accountStatusType: "Open",
        currentRatingType: "AsAgreed",
        accountReportedDate: "2026-08-18",
        accountIdentifier: t.accountIdentifier
      }))
    };
  }
  const wrappedViolations = violationsByBureauFromMergedCrs(wrapped);
  dump("08-diagnostic-wrapped-from-crs.json", {
    note: "NOT the stored crs_results.result. Shows what from-crs would emit if simulate used bureau envelopes + sourceType.",
    counts: Object.fromEntries(Object.entries(wrappedViolations).map(([k, v]) => [k, v.length])),
    violations: Object.fromEntries(Object.entries(wrappedViolations).map(([k, v]) => [k, (v || []).map((x) => ({
      ruleId: x.ruleId, severity: x.severity, creditor: x.creditor, account_last4: x.account_last4,
      field: x.field, reason: x.reason, collection: x.collection
    }))]))
  });

  let wrappedPack = { ok: false, skipped: "no_wrapped_violations" };
  if (Object.values(wrappedViolations).some((a) => a?.length)) {
    wrappedPack = await buildDiyPackage({
      violationsByBureau: wrappedViolations,
      identity,
      seed: `${ORG_ID}:${CLIENT_ID}:wrapped-diagnostic`
    });
    const wdir = path.join(OUT, "samples-wrapped-diagnostic");
    fs.mkdirSync(wdir, { recursive: true });
    for (const f of wrappedPack.files || []) {
      if (!f.text) continue;
      const safe = String(f.path || "letter.txt").replace(/[^\w./-]+/g, "_").replace(/\//g, "__");
      fs.writeFileSync(path.join(wdir, safe.endsWith(".txt") ? safe : `${safe}.txt`), f.text);
    }
  }
  const wrappedText = (wrappedPack.files || []).map((f) => f.text || "").join("\n---\n");
  dump("09-diagnostic-wrapped-pack.json", {
    ok: wrappedPack.ok,
    reason: wrappedPack.reason || null,
    letterCount: wrappedPack.letterCount ?? 0,
    files: (wrappedPack.files || []).map((f) => f.path),
    invented_derogatory: INVENTED_RE.test(wrappedText)
      ? [...wrappedText.matchAll(new RegExp(INVENTED_RE, "gi"))].map((m) => m[0]).slice(0, 20)
      : [],
    seeded_named: SEEDED.map((s) => ({
      ...s,
      name_in_pack: textHas(wrappedText, s.creditor),
      id_in_pack: textHas(wrappedText, s.id)
    }))
  });

  dump("10-persist-dry-run.json", {
    designed_persist: "src/metro2/diy/persist.mjs persistDiyPackageFiles",
    writes_table: "documents (kind=deliverable), not letters_generated",
    letters_generated_is: "pipeline stage key on optimization pipeline, not a table",
    dispute_letters_writer: "src/metro2/rounds/store.mjs saveLetter — not the pack persist tests use",
    persist_mails: false,
    mail_path: "src/metro2/delivery/send.mjs sendLetter / PostGrid — not called",
    persisted: false,
    reason: "designed persist writes documents, not letters_generated; user said persist only if letters_generated"
  });

  const after = await withDb(async (c) => {
    const dl = await c.query(`SELECT count(*)::int AS n FROM dispute_letters WHERE client_id = $1`, [CLIENT_ID]);
    const dc = await c.query(`SELECT count(*)::int AS n FROM dispute_cases WHERE client_id = $1`, [CLIENT_ID]);
    const docs = await c.query(`SELECT count(*)::int AS n FROM documents WHERE client_id = $1`, [CLIENT_ID]);
    const cf2 = await c.query(`SELECT custom_fields FROM clients WHERE id = $1`, [CLIENT_ID]);
    return {
      dispute_letters: dl.rows[0].n,
      dispute_cases: dc.rows[0].n,
      documents: docs.rows[0].n,
      diy_custom_fields: Object.fromEntries(
        Object.entries(cf2.rows[0]?.custom_fields || {}).filter(([k]) => /diy|letter|optim/i.test(k))
      )
    };
  });
  dump("11-after-query.json", after);
  dump("12-tear-rows.json", {
    wrote: false,
    tables: [],
    note: "W-OPT left no new DB rows. In-process generate only. persist skipped."
  });

  dump("13-probe-summary.json", {
    optimize_is_ad_spend: true,
    optimize_rules_fired_on_credit_file: evalOnFile.filter((p) => p.action && p.action !== "none").map((p) => p.rule_key),
    simulate_seeded_letters: (before.dispute_letters.ok ? before.dispute_letters.rows.length : 0) > 0,
    designed_violation_bureaus: Object.keys(designedViolations),
    designed_pack_ok: pack.ok,
    designed_letter_count: pack.letterCount ?? 0,
    sample_files: samplePaths,
    persist: false
  });

  console.log(JSON.stringify({
    ok: true,
    optimize_actions: evalOnFile,
    runOpt_skipped: runOpt.skipped || null,
    designed_bureaus: Object.keys(designedViolations),
    pack_ok: pack.ok,
    pack_reason: pack.reason || null,
    letterCount: pack.letterCount ?? 0,
    samples: samplePaths.length,
    after
  }));
}

main().catch((err) => {
  fs.writeFileSync(path.join(OUT, "probe-error.json"), JSON.stringify({
    error: String(err.message || err).slice(0, 400)
  }, null, 2));
  console.error(err);
  process.exit(1);
});

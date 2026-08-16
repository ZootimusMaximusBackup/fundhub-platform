#!/usr/bin/env node
/** Full sandbox gauntlet: CRS pulls, repair rounds, inquiry removal, funding, applications. */
import { loadEnv } from "./load-env.mjs";

loadEnv();
process.env.ADAPTERS_DRY_RUN = "0";

const { db, close } = await import("../src/db.mjs");
const { resolveDefaultOrg } = await import("../src/auth/org.mjs");
const { createCrsClient } = await import("../src/finance/crs-client.mjs");
const { BUREAUS, SANDBOX_TEST_IDENTITIES, identityForBureau } = await import("../src/finance/crs-identities.mjs");
const { normalizeFromCrs } = await import("../src/metro2/normalize.mjs");
const { runReport } = await import("../src/metro2/checks/index.mjs");
const { moveCardToStage } = await import("../src/workflows/cards.mjs");
const moneyChain = await import("../src/handlers/money-chain.mjs");
const registry = await import("../src/events/registry.mjs");
const bus = await import("../src/events/bus.mjs");
const { ingestCrsResult } = await import("../src/tradelines/store.mjs");
const { createCase } = await import("../src/inquiry-ops/cases.mjs");

const MARK = `gauntlet_${Date.now().toString(36)}`;
const report = { mark: MARK, started: new Date().toISOString(), phases: {}, failures: [], passes: [] };

function pass(id, detail) {
  report.passes.push({ id, detail });
}
function fail(id, detail) {
  report.failures.push({ id, detail });
}

async function cleanup(db, clientId) {
  const q = (sql, params) => db.query(sql, params).catch(() => {});
  await q(`DELETE FROM inquiry_removal_cases WHERE client_id = $1`, [clientId]);
  await q(`DELETE FROM applications WHERE client_id = $1`, [clientId]);
  await q(`DELETE FROM contracts WHERE client_id = $1`, [clientId]);
  await q(`DELETE FROM commission_ledger WHERE client_id = $1`, [clientId]);
  await q(
    `DELETE FROM funding_closeout WHERE funding_round_id IN (SELECT id FROM funding_rounds WHERE client_id = $1)`,
    [clientId]
  );
  await q(
    `DELETE FROM funding_round_sales WHERE funding_round_id IN (SELECT id FROM funding_rounds WHERE client_id = $1)`,
    [clientId]
  );
  await q(`DELETE FROM funding_rounds WHERE client_id = $1`, [clientId]);
  await q(`DELETE FROM tradelines WHERE client_id = $1`, [clientId]);
  await q(`DELETE FROM crs_results WHERE client_id = $1`, [clientId]);
  await q(`DELETE FROM cards WHERE client_id = $1`, [clientId]);
  await q(`DELETE FROM tasks WHERE client_id = $1`, [clientId]);
  await q(`DELETE FROM clients WHERE id = $1`, [clientId]);
}

try {
  bus._resetOrgCache();
  registry.clearHandlers();
  moneyChain.register();

  const orgId = await resolveDefaultOrg(db);
  report.orgId = orgId;

  report.phases.crs_sandbox = {};
  const crs = createCrsClient({ env: process.env });
  report.phases.crs_sandbox.host = crs.host;

  for (const bureau of BUREAUS) {
    try {
      const identity = identityForBureau({ host: crs.host, bureau, env: process.env });
      const pulled = await crs.orderPrequal({ bureau, identity });
      if (!pulled.ok) {
        fail(`crs_${bureau}`, pulled.error || "blocked");
        continue;
      }
      const { tradelines, context } = normalizeFromCrs(pulled.report, { asOf: "2026-08-16" });
      const eng = runReport(tradelines, context);
      report.phases.crs_sandbox[bureau] = {
        ok: true,
        tradelines: tradelines.length,
        violations: eng.violations?.length || 0,
        inquiries: eng.inquiries?.length || 0,
        identity: SANDBOX_TEST_IDENTITIES[bureau].lastName
      };
      pass(`crs_sandbox_${bureau}`, `${tradelines.length} tradelines`);
    } catch (e) {
      fail(`crs_${bureau}`, String(e.message || e));
    }
  }

  const clientRow = (
    await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name, outcome_tier, is_demo)
       VALUES ($1, $2, 'Sandbox', 'Gauntlet', 'FULL_FUNDING', true)
       RETURNING id, email`,
      [orgId, `${MARK}@demo.fundhub.local`]
    )
  ).rows[0];
  report.clientId = clientRow.id;
  pass("client_create", clientRow.id);

  const exIdentity = identityForBureau({ host: crs.host, bureau: "EX", env: process.env });
  const exPull = await crs.orderPrequal({ bureau: "EX", identity: exIdentity });
  if (exPull.ok) {
    const norm = normalizeFromCrs(exPull.report, { asOf: "2026-08-16" });
    const payload = {
      tradelines: norm.tradelines,
      consumerSignals: { scores: { perBureau: { ex: 650 } } },
      outcome: "FULL_FUNDING",
      bureaus: { EX: exPull.report }
    };
    const crsId = (
      await db.query(
        `INSERT INTO crs_results (org_id, client_id, result, outcome_tier, is_demo)
         VALUES ($1, $2, $3::jsonb, 'FULL_FUNDING', true)
         RETURNING id, org_id, client_id, result`,
        [orgId, clientRow.id, JSON.stringify(payload)]
      )
    ).rows[0];
    const ingested = await ingestCrsResult(db, crsId);
    pass("crs_ingest", `${ingested.ingested} tradelines`);
    report.phases.crs_ingest = { crsId: crsId.id, tradelines: ingested.ingested };
  } else {
    fail("crs_ingest", exPull.error);
  }

  for (const [pipe, stages] of [
    ["sales", ["new_lead", "survey_complete", "booked"]],
    [
      "optimization",
      ["intake", "letters_generated", "ready_to_send", "in_transit", "round_complete", "program_complete"]
    ],
    ["funding_card_stacking", ["apply_now", "round_submitted", "approved"]]
  ]) {
    report.phases[`pipeline_${pipe}`] = [];
    for (const stage of stages) {
      try {
        const r = await moveCardToStage(db, {
          orgId,
          clientId: clientRow.id,
          pipelineKey: pipe,
          stageKey: stage
        });
        report.phases[`pipeline_${pipe}`].push({
          stage,
          moved: r.moved,
          deduped: r.roundEvent?.deduped
        });
        if (r.moved || r.roundEvent?.deduped) pass(`${pipe}_${stage}`, "ok");
        else fail(`${pipe}_${stage}`, "not moved");
      } catch (e) {
        fail(`${pipe}_${stage}`, String(e.message || e));
      }
    }
  }

  try {
    const staff = (await db.query(`SELECT id FROM staff WHERE org_id = $1 AND role = 'owner' LIMIT 1`, [orgId])).rows[0];
    const ir = await createCase(db, {
      orgId,
      clientId: clientRow.id,
      bureau: "EX",
      createdByStaffId: staff?.id || null,
      notes: `gauntlet ${MARK}`
    });
    pass("inquiry_case", ir.id);
    report.phases.inquiry_removal = { id: ir.id, status: ir.status };
  } catch (e) {
    fail("inquiry_case", String(e.message || e));
  }

  const round = (
    await db.query(
      `SELECT id, status, round_number, approved_amount
         FROM funding_rounds
        WHERE client_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [clientRow.id]
    )
  ).rows[0];

  if (round) {
    pass("funding_round", `${round.status} round ${round.round_number}`);
    report.phases.funding_round = round;
    try {
      const app = (
        await db.query(
          `INSERT INTO applications (org_id, funding_round_id, client_id, bank, status, approved_amount)
           VALUES ($1, $2, $3, 'Chase', 'approved', 45000)
           RETURNING id`,
          [orgId, round.id, clientRow.id]
        )
      ).rows[0];
      pass("application", app.id);
      report.phases.application = app;
      await moveCardToStage(db, {
        orgId,
        clientId: clientRow.id,
        pipelineKey: "funding_card_stacking",
        stageKey: "funded",
        extra: { fundedAmount: 45000 }
      });
      const funded = (await db.query(`SELECT status, funded_amount FROM funding_rounds WHERE id = $1`, [round.id])).rows[0];
      report.phases.funded = funded;
      pass("funded", funded?.status);
    } catch (e) {
      fail("application", String(e.message || e));
    }
  } else {
    fail("funding_round", "none created");
  }

  try {
    const tmpl = (await db.query(`SELECT id FROM contract_templates WHERE org_id = $1 LIMIT 1`, [orgId])).rows[0];
    if (tmpl) {
      const c = (
        await db.query(
          `INSERT INTO contracts (org_id, client_id, template_id, status, title)
           VALUES ($1, $2, $3, 'draft', 'Gauntlet Test')
           RETURNING id, status`,
          [orgId, clientRow.id, tmpl.id]
        )
      ).rows[0];
      pass("contract_draft", c.id);
      report.phases.contract = c;
    } else {
      fail("contract_draft", "no template");
    }
  } catch (e) {
    fail("contract_draft", String(e.message || e));
  }

  report.phases.tags = (await db.query(`SELECT tags FROM clients WHERE id = $1`, [clientRow.id])).rows[0]?.tags;
  report.phases.tasks = (
    await db.query(`SELECT title FROM tasks WHERE client_id = $1 LIMIT 8`, [clientRow.id])
  ).rows.map((r) => r.title);

  report.score = `${report.passes.length}/${report.passes.length + report.failures.length}`;
  report.clientEmail = clientRow.email;

  await cleanup(db, clientRow.id);
} catch (e) {
  report.fatal = String(e.message || e);
}

report.finished = new Date().toISOString();
console.log(JSON.stringify(report, null, 2));
await close();
process.exit(report.failures.length ? 1 : 0);

// The training record, against real Postgres.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): these cases decide whether a partner
// holds a compliance certification.
//
// curriculum.test.mjs proves the two copies of the list agree. entitlement.test.mjs
// proves the access decisions. These prove the things only a database can:
//
//   * 284 really seeds thirteen modules and four gates, in delivery order.
//   * Recording the same module twice updates one row (the unique index), and
//     roll being called again cannot UNDO a completion that has already let a
//     gate pass.
//   * A gate cannot be passed out of order, and cannot be passed while a module
//     taught in its week is unfinished. These two are the whole control: without
//     them a partner reaches a live buyer call with no compliance certification.
//   * A revoked gate really does read as not-passed, from the newest row.
//   * The evidence cannot be deleted or edited — both triggers RAISE.
//   * One partner's record never appears in another partner's view.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs file.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";

import { MODULES, GATE_CODES } from "./curriculum.mjs";
import { trainingAccessFor, TrainingAccessError } from "./entitlement.mjs";
import { recordModuleProgress, moduleRowsFor, trainingViewFor, ProgressError } from "./progress.mjs";
import { hasPassedGate, gateStandingsFor, recordGateDecision, sellingRelease, GateError } from "./gates.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG = "training-test-partner";
const SLUG_OTHER = "training-test-other";

describe("partner training", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, partnerId, otherPartnerId;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();
    partnerId = await seedPartner(SLUG, "Training Test Partner", { active: true, signed: true });
    otherPartnerId = await seedPartner(SLUG_OTHER, "Training Test Other", { active: true, signed: true });
  });

  after(async () => { await cleanup(); await close(); });

  beforeEach(async () => { await clearRecords(); });

  async function seedPartner(slug, name, { active = true, signed = true } = {}) {
    return (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at, revenue_share_pct)
       VALUES ($1, $2, $3, $4, $5, 50) RETURNING id`,
      [org, name, slug, active ? "active" : "invited", signed ? new Date() : null]
    )).rows[0].id;
  }

  async function clearRecords() {
    const ids = [partnerId, otherPartnerId].filter(Boolean);
    if (!ids.length) return;
    await db.query(`DELETE FROM partner_training_progress WHERE partner_id = ANY($1)`, [ids]);
    // The gate record is append-only by trigger; a fixture is the one place that
    // is allowed to turn it off, and it turns it straight back on.
    await db.query(`ALTER TABLE partner_training_gates DISABLE TRIGGER trg_ptg_no_delete`);
    await db.query(`DELETE FROM partner_training_gates WHERE partner_id = ANY($1)`, [ids]);
    await db.query(`ALTER TABLE partner_training_gates ENABLE TRIGGER trg_ptg_no_delete`);
  }

  async function cleanup() {
    await db.query(`ALTER TABLE partner_training_gates DISABLE TRIGGER trg_ptg_no_delete`);
    await db.query(
      `DELETE FROM partner_training_gates WHERE partner_id IN
         (SELECT id FROM partners WHERE slug LIKE 'training-test%')`);
    await db.query(`ALTER TABLE partner_training_gates ENABLE TRIGGER trg_ptg_no_delete`);
    await db.query(
      `DELETE FROM partner_training_progress WHERE partner_id IN
         (SELECT id FROM partners WHERE slug LIKE 'training-test%')`);
    await db.query(`DELETE FROM partners WHERE slug LIKE 'training-test%'`);
  }

  /** Mark every module a gate waits on as complete, so the gate can be reached. */
  async function completeModulesFor(gate, partner = partnerId) {
    for (const m of MODULES.filter((x) => x.gateCode === gate)) {
      await recordModuleProgress(db, {
        orgId: org, partnerId: partner, moduleCode: m.code, status: "complete"
      });
    }
  }

  /** Pass every gate up to and including `gate`, doing the modules on the way. */
  async function passUpTo(gate, partner = partnerId) {
    for (const code of GATE_CODES) {
      await completeModulesFor(code, partner);
      await recordGateDecision(db, { orgId: org, partnerId: partner, gate: code, outcome: "passed" });
      if (code === gate) return;
    }
  }

  // ------------------------------------------------------------------ SEED

  test("284 seeded the thirteen modules and the four gates, in delivery order", async () => {
    const rows = await moduleRowsFor(db, { orgId: org, partnerId });
    assert.equal(rows.length, 13);
    assert.deepEqual(rows.map((r) => r.code), MODULES.map((m) => m.code));
    // m12 keeps its unknown week all the way through the join.
    assert.strictEqual(rows.find((r) => r.code === "m12").week_no, null);
    // Nothing started, so every status is null rather than a fabricated zero.
    assert.deepEqual([...new Set(rows.map((r) => r.status))], [null]);

    const gates = await gateStandingsFor(db, { orgId: org, partnerId });
    assert.deepEqual(gates.map((g) => g.code), GATE_CODES);
    for (const g of gates) {
      assert.strictEqual(g.passed, false);
      // Never assessed is NOT failed. The screen has to be able to tell them apart.
      assert.strictEqual(g.outcome, null);
      assert.ok(g.blocks && g.blocks.length > 20, `${g.code} lost its "what this blocks" sentence`);
    }
  });

  // ----------------------------------------------------------- ENTITLEMENT

  test("entitlement reads the real partner row", async () => {
    const ok = await trainingAccessFor(db, { orgId: org, partnerId });
    assert.strictEqual(ok.allowed, true);

    const paused = await seedPartner("training-test-paused", "Training Test Paused", { active: false });
    const no = await trainingAccessFor(db, { orgId: org, partnerId: paused });
    assert.strictEqual(no.allowed, false);
    assert.strictEqual(no.reason, "partner_not_active");

    // And a write refuses on the same verdict rather than recording anyway.
    await assert.rejects(
      () => recordModuleProgress(db, { orgId: org, partnerId: paused, moduleCode: "m1", status: "complete" }),
      (err) => err instanceof TrainingAccessError && err.code === "partner_not_active");
  });

  // -------------------------------------------------------------- PROGRESS

  test("recording the same module twice updates one row, not two", async () => {
    await recordModuleProgress(db, { orgId: org, partnerId, moduleCode: "m1", status: "attended" });
    await recordModuleProgress(db, { orgId: org, partnerId, moduleCode: "m1", status: "complete" });

    const { rows } = await db.query(
      `SELECT status, attended_at, completed_at FROM partner_training_progress
        WHERE org_id = $1 AND partner_id = $2`, [org, partnerId]);
    assert.equal(rows.length, 1, "284's unique index is what makes a re-run safe");
    assert.equal(rows[0].status, "complete");
    assert.ok(rows[0].attended_at, "the attendance date survived the completion");
    assert.ok(rows[0].completed_at);
  });

  test("roll being called again cannot un-complete a module", async () => {
    /* This is the case that matters. A completion is what lets a gate pass, so
       an 'attended' write landing on top of a 'complete' one would silently
       un-certify a partner who had already cleared a compliance gate. */
    await recordModuleProgress(db, { orgId: org, partnerId, moduleCode: "m7", status: "complete" });
    await recordModuleProgress(db, { orgId: org, partnerId, moduleCode: "m7", status: "attended" });
    const rows = await moduleRowsFor(db, { orgId: org, partnerId });
    assert.equal(rows.find((r) => r.code === "m7").status, "complete");
  });

  test("an unknown module and an unknown status are refused by name", async () => {
    await assert.rejects(
      () => recordModuleProgress(db, { orgId: org, partnerId, moduleCode: "m14", status: "complete" }),
      (err) => err instanceof ProgressError && err.code === "unknown_module");
    await assert.rejects(
      () => recordModuleProgress(db, { orgId: org, partnerId, moduleCode: "m1", status: "watched" }),
      (err) => err instanceof ProgressError && err.code === "unknown_status");
  });

  // ----------------------------------------------------------------- GATES

  test("a gate cannot pass while a module taught in its week is unfinished", async () => {
    // W7: attendance is a gate, not a suggestion.
    await recordModuleProgress(db, { orgId: org, partnerId, moduleCode: "m1", status: "complete" });
    await assert.rejects(
      () => recordGateDecision(db, { orgId: org, partnerId, gate: "G1", outcome: "passed" }),
      (err) => err instanceof GateError && err.code === "modules_incomplete");

    await recordModuleProgress(db, { orgId: org, partnerId, moduleCode: "m2", status: "complete" });
    const row = await recordGateDecision(db, { orgId: org, partnerId, gate: "G1", outcome: "passed" });
    assert.equal(row.outcome, "passed");
    assert.strictEqual(await hasPassedGate(db, { orgId: org, partnerId, gate: "G1" }), true);
  });

  test("a gate cannot pass out of order — G2 before G1 is refused", async () => {
    /* The refusal that stops a partner reaching a live buyer call with no
       compliance certification behind them. */
    await completeModulesFor("G2");
    await assert.rejects(
      () => recordGateDecision(db, { orgId: org, partnerId, gate: "G2", outcome: "passed" }),
      (err) => err instanceof GateError && err.code === "out_of_order");
  });

  test("a FAILURE is always recordable, in any order, with no modules done", async () => {
    // Refusing to record a failure would leave the honest outcome with nowhere
    // to go, and the dated attempt is exactly what W7 wants kept.
    const row = await recordGateDecision(db, { orgId: org, partnerId, gate: "G3", outcome: "failed" });
    assert.equal(row.outcome, "failed");
    const gates = await gateStandingsFor(db, { orgId: org, partnerId });
    const g3 = gates.find((g) => g.code === "G3");
    assert.strictEqual(g3.passed, false);
    assert.equal(g3.outcome, "failed", "failed must not read back as never-assessed");
  });

  test("a revoked gate reads as not passed, from the newest row", async () => {
    await passUpTo("G2");
    assert.strictEqual(await hasPassedGate(db, { orgId: org, partnerId, gate: "G2" }), true);

    await recordGateDecision(db, { orgId: org, partnerId, gate: "G2", outcome: "revoked" });
    assert.strictEqual(await hasPassedGate(db, { orgId: org, partnerId, gate: "G2" }), false);

    // Both rows survive — the pass and the revocation are both evidence.
    const { rows } = await db.query(
      `SELECT outcome FROM partner_training_gates
        WHERE partner_id = $1 AND gate_code = 'G2' ORDER BY decided_at`, [partnerId]);
    assert.deepEqual(rows.map((r) => r.outcome), ["passed", "revoked"]);
  });

  test("revoking a gate that is not passed is refused", async () => {
    await assert.rejects(
      () => recordGateDecision(db, { orgId: org, partnerId, gate: "G1", outcome: "revoked" }),
      (err) => err instanceof GateError && err.code === "not_passed");
  });

  test("an unknown gate throws rather than quietly answering 'not passed'", async () => {
    await assert.rejects(
      () => hasPassedGate(db, { orgId: org, partnerId, gate: "G9" }),
      (err) => err instanceof GateError && err.code === "unknown_gate");
  });

  // -------------------------------------------------------------- EVIDENCE

  test("a gate decision cannot be deleted", async () => {
    await passUpTo("G1");
    await assert.rejects(
      () => db.query(`DELETE FROM partner_training_gates WHERE partner_id = $1`, [partnerId]),
      /not deletable/);
  });

  test("a gate decision cannot be edited", async () => {
    await passUpTo("G1");
    await assert.rejects(
      () => db.query(
        `UPDATE partner_training_gates SET outcome = 'failed' WHERE partner_id = $1`, [partnerId]),
      /immutable/);
  });

  // ------------------------------------------------------------- THE VIEW

  test("the view says what is next, and whether they may sell yet", async () => {
    let view = await trainingViewFor(db, { orgId: org, partnerId });
    assert.equal(view.modules_total, 13);
    assert.equal(view.modules_complete, 0);
    assert.equal(view.next_module.code, "m1", "the first module in DELIVERY order");
    assert.equal(view.next_gate.code, "G1");
    assert.strictEqual(view.may_sell_supervised, false);
    assert.strictEqual(view.may_sell_unsupervised, false);
    assert.deepEqual(view.gates_outstanding, ["G1", "G2", "G3", "G4"]);
    assert.strictEqual(view.curriculum_seeded, true);

    await passUpTo("G3");
    view = await trainingViewFor(db, { orgId: org, partnerId });
    // G1, G2 and G3 are what stand in front of selling under FundHub's brand.
    assert.strictEqual(view.may_sell_supervised, true);
    // G4 is the release from supervision, and it is a separate question.
    assert.strictEqual(view.may_sell_unsupervised, false);
    assert.equal(view.next_gate.code, "G4");
    assert.deepEqual(view.gates_outstanding, ["G4"]);
  });

  test("sellingRelease and the view agree — there is one definition, not two", async () => {
    await passUpTo("G4");
    const release = await sellingRelease(db, { orgId: org, partnerId });
    const view = await trainingViewFor(db, { orgId: org, partnerId });
    assert.strictEqual(release.may_sell_unsupervised, true);
    assert.strictEqual(view.may_sell_unsupervised, release.may_sell_unsupervised);
    assert.strictEqual(view.may_sell_supervised, release.may_sell_supervised);
    assert.deepEqual(view.gates_outstanding, []);
    assert.strictEqual(view.next_gate, null);

    /* ALL FOUR GATES PASSED IS NOT ALL THIRTEEN MODULES DONE, and the screen
       must not imply it is. W7 attaches m3, m4, m5 (week 2) and m12 to no gate
       at all, so nine modules stand behind the four gates and four do not. A
       partner released to sell can still have week 2 outstanding — which is a
       true thing about this curriculum, not a bug in the counting. */
    assert.equal(view.modules_complete, 9);
    assert.equal(view.next_module.code, "m3");
  });

  test("every module is done once the four with no gate are recorded too", async () => {
    await passUpTo("G4");
    for (const code of ["m3", "m4", "m5", "m12"]) {
      await recordModuleProgress(db, { orgId: org, partnerId, moduleCode: code, status: "complete" });
    }
    const view = await trainingViewFor(db, { orgId: org, partnerId });
    assert.equal(view.modules_complete, 13);
    assert.strictEqual(view.next_module, null);
  });

  // ------------------------------------------------------------ ISOLATION

  test("one partner's record never appears in another partner's view", async () => {
    await passUpTo("G2", partnerId);

    const otherView = await trainingViewFor(db, { orgId: org, partnerId: otherPartnerId });
    assert.equal(otherView.modules_complete, 0,
      "the other partner picked up somebody else's completed modules");
    assert.deepEqual(otherView.gates.filter((g) => g.passed).map((g) => g.code), []);
    assert.strictEqual(
      await hasPassedGate(db, { orgId: org, partnerId: otherPartnerId, gate: "G2" }), false);
  });

  test("a partner id from another company resolves to nothing, not to a curriculum", async () => {
    const otherOrg = (await db.query(
      `INSERT INTO orgs (name, slug) VALUES ('Training Test Co', 'training-test-co')
       ON CONFLICT DO NOTHING RETURNING id`)).rows[0];
    const otherOrgId = otherOrg
      ? otherOrg.id
      : (await db.query(`SELECT id FROM orgs WHERE slug = 'training-test-co'`)).rows[0].id;
    try {
      const access = await trainingAccessFor(db, { orgId: otherOrgId, partnerId });
      assert.strictEqual(access.allowed, false);
      assert.strictEqual(access.reason, "no_partner");
    } finally {
      await db.query(`DELETE FROM orgs WHERE slug = 'training-test-co'`);
    }
  });
});

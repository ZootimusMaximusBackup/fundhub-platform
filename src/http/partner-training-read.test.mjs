// GET /api/read/partner-training — the gate and the refusal, not the SQL.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): this endpoint reports whether a
// partner holds the two compliance certifications.
//
// src/training/training.pg.test.mjs proves the record against real Postgres.
// What is proved here is the part that lives in the handler and nowhere else:
//
//   * it is in the ROUTES map, because a handler file is not a route (§12)
//   * a partner who is not entitled gets 403 WITH A REASON, not a 404, not an
//     empty curriculum, and not "not signed in"
//   * a staff caller gets the record even when the partner is not entitled,
//     because a trainer has to be able to see why somebody is locked out
//   * a staff caller with no ?partner_id= is told which parameter is missing
//   * the org is bound on the partner lookup and comes from the session
//   * the write endpoint is staff-only, longhand, so the journey extractor can
//     read the role set rather than publishing "any signed in employee"
//
// It lives under src/ because npm test's glob is src/** and scripts/** only — a
// test under api/ silently never runs (CLAUDE.md §12).

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchTraining } from "../../api/read/partner-training.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { MODULES, GATES } from "../training/curriculum.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";

/** A tx stub that answers by matching a fragment of the SQL. */
function stubTx(script) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [needle, reply] of script) {
        if (sql.includes(needle)) return typeof reply === "function" ? reply(params) : reply;
      }
      throw new Error(`stubTx: no scripted reply for: ${sql.slice(0, 90)}`);
    }
  };
}

/* The four reads fetchTraining makes: the partner row (twice — once for the org
   check, once inside the entitlement module), the module catalogue with progress,
   the gate catalogue, and the latest gate decisions. */
function script({ partner, modules = [], gates = [], decisions = [] } = {}) {
  return [
    ["FROM partners", { rows: partner ? [partner] : [] }],
    ["FROM training_modules m", { rows: modules }],
    ["FROM training_gates", { rows: gates }],
    ["FROM partner_training_gates g", { rows: decisions }],
    ["FROM partner_training_gates\n", { rows: decisions }]
  ];
}

const activePartner = {
  id: PARTNER, org_id: ORG, status: "active",
  agreement_signed_at: "2026-08-20T00:00:00.000Z"
};

const catalogueRows = MODULES.map((m, i) => ({
  id: `mod-${i}`, code: m.code, position: m.position, title: m.title,
  week_no: m.weekNo, gate_code: m.gateCode, certified: m.certified,
  status: null, attended_at: null, completed_at: null,
  recorded_by_staff_id: null, notes: null
}));

const gateRows = GATES.map((g) => ({
  code: g.code, position: g.position, title: g.title,
  week_due: g.weekDue, blocks: `what ${g.code} blocks`
}));

describe("the route exists", () => {
  test("a handler file is not a route — both of these are in the ROUTES map", () => {
    assert.equal(typeof ROUTES["read/partner-training"], "function");
    assert.equal(typeof ROUTES["training-progress"], "function");
  });
});

describe("the payload", () => {
  test("an entitled partner gets the curriculum, the gates and what is next", async () => {
    const tx = stubTx(script({ partner: activePartner, modules: catalogueRows, gates: gateRows }));
    const view = await fetchTraining(tx, { partnerId: PARTNER, orgId: ORG });

    assert.strictEqual(view.entitled, true);
    assert.strictEqual(view.entitlement_reason, null);
    assert.equal(view.modules.length, 13);
    assert.equal(view.gates.length, 4);
    assert.equal(view.next_module.code, "m1");
    assert.equal(view.next_gate.code, "G1");
    assert.strictEqual(view.may_sell_supervised, false);
    assert.strictEqual(view.curriculum_seeded, true);
  });

  test("the org is bound on the partner lookup", async () => {
    const tx = stubTx(script({ partner: activePartner, modules: catalogueRows, gates: gateRows }));
    await fetchTraining(tx, { partnerId: PARTNER, orgId: ORG });
    const lookup = tx.calls.find((c) => c.sql.includes("FROM partners"));
    assert.match(lookup.sql, /org_id\s*=\s*\$2/);
    assert.deepEqual(lookup.params, [PARTNER, ORG]);
  });

  test("a partner in another company is not found rather than partly answered", async () => {
    const tx = stubTx(script({ partner: null }));
    const view = await fetchTraining(tx, { partnerId: PARTNER, orgId: ORG });
    assert.strictEqual(view, null, "the handler turns this into a 404");
  });

  test("an unentitled partner's payload carries the reason and a readable sentence", async () => {
    const tx = stubTx(script({
      partner: { ...activePartner, agreement_signed_at: null },
      modules: catalogueRows, gates: gateRows
    }));
    const view = await fetchTraining(tx, { partnerId: PARTNER, orgId: ORG });
    assert.strictEqual(view.entitled, false);
    assert.equal(view.entitlement_reason, "agreement_unsigned");
    assert.ok(view.entitlement_message.length > 10);
    // NULL survives — an unsigned agreement is a real state, not a zero.
    assert.strictEqual(view.agreement_signed_at, null);
  });

  test("a company with no seeded curriculum says so instead of reading as unstarted", async () => {
    const tx = stubTx(script({ partner: activePartner, modules: [], gates: [] }));
    const view = await fetchTraining(tx, { partnerId: PARTNER, orgId: ORG });
    assert.strictEqual(view.curriculum_seeded, false);
    assert.equal(view.modules_total, 0);
    // The gate names still come back from the constants, so the screen is not
    // blank — but `blocks` stays null because that wording lives in the seed.
    assert.equal(view.gates.length, 4);
    assert.strictEqual(view.gates[0].blocks, null);
  });
});

describe("the handler's own decisions", () => {
  const source = fs.readFileSync(
    path.resolve(HERE, "../../api/read/partner-training.mjs"), "utf8");

  test("a partner who is not entitled is refused, not quietly served", () => {
    assert.match(source, /principal\.kind === "partner" && !view\.entitled/);
    assert.match(source, /status\(403\)/);
    assert.match(source, /not_entitled/);
  });

  test("it serves partner and staff, and nobody else", () => {
    assert.match(source, /requirePrincipal\(req, res, \["partner", "staff"\]/);
  });

  test("the tenancy decision is imported, not re-implemented", () => {
    // One resolvePartnerId for every partner read: a partner is pinned to their
    // own id and a partner_id in their query string is ignored.
    assert.match(source, /import \{ resolvePartnerId[\s\S]*?\} from "\.\.\/\.\.\/src\/http\/partner-read-api\.mjs"/);
    assert.match(source, /withPartnerScope\(/);
  });
});

describe("the write endpoint", () => {
  const source = fs.readFileSync(
    path.resolve(HERE, "../../api/training-progress.mjs"), "utf8");

  test("it is staff-only, and the role set is written longhand", () => {
    /* scripts/journeys/extract.mjs resolves a bare identifier or a
       `new Set([...])` of quoted strings and nothing else. A gate it cannot read
       is published on the journey pages as "any signed in employee". */
    assert.match(source, /const TRAINING_WRITE_ROLES = new Set\(\["owner", "admin"\]\)/);
    assert.match(source, /requireRole\(res, staff, TRAINING_WRITE_ROLES\)/);
  });

  test("requireAuth is gated by a SECOND call, because it ignores a roles key", () => {
    // CLAUDE.md §12: requireAuth forwards opts to authenticate(), which reads
    // only { db, env }. A roles key there does nothing at all.
    assert.ok(!/requireAuth\([^)]*roles/.test(source),
      "a roles key passed to requireAuth is silently dropped — gate with requireRole after it");
  });

  test("there is no partner write path anywhere in training", () => {
    /* A partner who could record their own compliance module would be a partner
       with no compliance certification. Neither the endpoint nor the screen may
       ever offer one. */
    assert.ok(!/requirePrincipal/.test(source),
      "the training write endpoint must not admit a non-staff principal");
    /* COMMENTS ARE STRIPPED FIRST. The screen's header says out loud that
       FundHub records progress through /api/training-progress and that the page
       does not — matching raw source would fail the file for documenting the
       rule it obeys. Match the code; read the prose. */
    const screen = fs.readFileSync(
      path.resolve(HERE, "../../public/app/partner-training.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    assert.ok(!/training-progress/.test(screen),
      "the partner screen must not call the write endpoint");
    assert.ok(!/method:\s*["']POST["']/i.test(screen),
      "the partner training screen is read-only");
  });
});

// The curriculum in code and the curriculum in the migration must be one list.
//
// WHY THIS TEST EXISTS. src/training/curriculum.mjs and
// db/migrations/284_training_delivery.sql both carry W7's thirteen modules and
// four gates. Two copies of a list is two lists, and the failure mode is quiet:
// a screen sorted by one order while the database seeds another, or a module
// renamed in code while the seeded row keeps the old title. So this reads 284 as
// TEXT and fails if the two disagree on a code, a title, a position, a week, a
// gate or the certified flag.
//
// It reads the migration rather than the database on purpose. There is no
// DATABASE_URL in most runs, and the thing worth guarding is the SOURCE agreeing
// with itself — a seeded database is downstream of both.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MODULES, MODULE_CODES, GATES, GATE_CODES, GATE_OUTCOMES, PROGRESS_STATUSES,
  isModuleCode, isGateCode, modulesForGate, previousGate,
  TEACHING_WEEKS, TOTAL_WEEKS
} from "./curriculum.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(HERE, "../../db/migrations/284_training_delivery.sql");
const SQL = fs.readFileSync(MIGRATION, "utf8");

/* The VALUES rows of the module seed, parsed out of the migration. Written as a
   line-by-line scan rather than one big regex because the titles contain commas,
   apostrophes (doubled, as SQL wants) and the word NULL. */
function seededModules() {
  const out = [];
  const re = /^\s*\('(m\d+)',\s*(\d+),\s*'(.*)',\s*(\d+|NULL),\s*(?:'(G\d)'|NULL),\s*(true|false)\)/;
  for (const line of SQL.split("\n")) {
    const m = re.exec(line);
    if (!m) continue;
    out.push({
      code: m[1],
      position: Number(m[2]),
      // Titles are single-quoted SQL literals: '' is one apostrophe. Trailing
      // whitespace is column alignment in the migration, not part of the name.
      title: m[3].trim().replace(/''/g, "'"),
      weekNo: m[4] === "NULL" ? null : Number(m[4]),
      gateCode: m[5] || null,
      certified: m[6] === "true"
    });
  }
  return out;
}

function seededGates() {
  const out = [];
  const re = /^\s*\('(G\d)',\s*(\d+),\s*'([^']*)',\s*(\d+),$/;
  for (const line of SQL.split("\n")) {
    const m = re.exec(line);
    if (!m) continue;
    out.push({ code: m[1], position: Number(m[2]), title: m[3], weekDue: Number(m[4]) });
  }
  return out;
}

describe("the curriculum is thirteen modules and four gates", () => {
  test("W7's thirteen are all here, once each", () => {
    assert.equal(MODULES.length, 13);
    assert.equal(new Set(MODULE_CODES).size, 13);
    for (let n = 1; n <= 13; n++) {
      assert.ok(MODULE_CODES.includes("m" + n), `m${n} is missing from the curriculum`);
    }
  });

  test("positions are 1..13 with no gaps and no duplicates", () => {
    const positions = MODULES.map((m) => m.position).sort((a, b) => a - b);
    assert.deepEqual(positions, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  test("the delivery order is NOT the module-number order, and that is the point", () => {
    /* W7's "THE FIRST 30 DAYS": week 3 is M7 and M8, week 4 is M6, M9, M10, M11.
       Compliance is taught before the call module because G2 has to clear before
       any public asset goes live and G3 before any live buyer call. A screen
       sorted by module number would show the partner the wrong week. */
    const byPosition = [...MODULES].sort((a, b) => a.position - b.position).map((m) => m.code);
    assert.deepEqual(byPosition, [
      "m1", "m2", "m3", "m4", "m5", "m7", "m8", "m6", "m9", "m10", "m11", "m12", "m13"
    ]);
    const m7 = MODULES.find((m) => m.code === "m7");
    const m6 = MODULES.find((m) => m.code === "m6");
    assert.ok(m7.position < m6.position, "compliance I must be taught before the call module");
  });

  test("exactly three modules are certified, and they are the ones W7 marks", () => {
    const certified = MODULES.filter((m) => m.certified).map((m) => m.code).sort();
    assert.deepEqual(certified, ["m6", "m7", "m8"]);
  });

  test("m12 has no week, because W7 does not give it one", () => {
    // NULL means unknown and it must survive (CLAUDE.md §12). A plausible week
    // here would be an invented fact about a regulated training programme.
    const m12 = MODULES.find((m) => m.code === "m12");
    assert.strictEqual(m12.weekNo, null);
    assert.strictEqual(m12.gateCode, null);
    const missingWeek = MODULES.filter((m) => m.weekNo === null).map((m) => m.code);
    assert.deepEqual(missingWeek, ["m12"], "only m12 is unscheduled in W7");
  });

  test("the four gates are in order, and every gate code on a module is one of them", () => {
    assert.deepEqual(GATE_CODES, ["G1", "G2", "G3", "G4"]);
    assert.deepEqual(GATES.map((g) => g.position), [1, 2, 3, 4]);
    for (const m of MODULES) {
      if (m.gateCode) assert.ok(isGateCode(m.gateCode), `${m.code} names an unknown gate`);
    }
  });

  test("each gate is fed by the modules W7 teaches in its week", () => {
    assert.deepEqual(modulesForGate("G1").map((m) => m.code), ["m1", "m2"]);
    // The two certified compliance modules, and nothing else, stand behind G2.
    assert.deepEqual(modulesForGate("G2").map((m) => m.code), ["m7", "m8"]);
    assert.deepEqual(modulesForGate("G3").map((m) => m.code), ["m6", "m9", "m10", "m11"]);
    assert.deepEqual(modulesForGate("G4").map((m) => m.code), ["m13"]);
    // Week 2 attaches to no gate in W7, so nothing may claim it does.
    for (const code of ["m3", "m4", "m5", "m12"]) {
      assert.strictEqual(MODULES.find((m) => m.code === code).gateCode, null);
    }
  });

  test("previousGate walks the ladder and stops at the bottom", () => {
    assert.strictEqual(previousGate("G1"), null);
    assert.strictEqual(previousGate("G2"), "G1");
    assert.strictEqual(previousGate("G4"), "G3");
    assert.strictEqual(previousGate("g3"), "G2", "gate codes are case-insensitive on input");
  });

  test("the closed sets stay closed", () => {
    assert.deepEqual(PROGRESS_STATUSES, ["attended", "complete"]);
    assert.deepEqual(GATE_OUTCOMES, ["passed", "failed", "revoked"]);
    assert.ok(isModuleCode("M7"), "module codes are case-insensitive on input");
    assert.ok(!isModuleCode("m14"));
    assert.ok(!isGateCode("G5"));
    assert.equal(TEACHING_WEEKS, 4);
    assert.equal(TOTAL_WEEKS, 12);
  });
});

describe("the code list and migration 284 are the same list", () => {
  test("the migration seeds all thirteen modules, identically", () => {
    const seeded = seededModules();
    assert.equal(seeded.length, 13,
      `284 seeds ${seeded.length} modules — the parser above or the migration has moved`);
    const byCode = new Map(seeded.map((m) => [m.code, m]));
    for (const m of MODULES) {
      const row = byCode.get(m.code);
      assert.ok(row, `284 does not seed ${m.code}`);
      assert.equal(row.title, m.title, `${m.code}: title differs between code and migration`);
      assert.equal(row.position, m.position, `${m.code}: position differs`);
      assert.strictEqual(row.weekNo, m.weekNo, `${m.code}: week differs`);
      assert.strictEqual(row.gateCode, m.gateCode, `${m.code}: gate differs`);
      assert.strictEqual(row.certified, m.certified, `${m.code}: certified flag differs`);
    }
  });

  test("the migration seeds all four gates, identically", () => {
    const seeded = seededGates();
    assert.equal(seeded.length, 4, `284 seeds ${seeded.length} gates`);
    const byCode = new Map(seeded.map((g) => [g.code, g]));
    for (const g of GATES) {
      const row = byCode.get(g.code);
      assert.ok(row, `284 does not seed ${g.code}`);
      assert.equal(row.title, g.title, `${g.code}: title differs between code and migration`);
      assert.equal(row.position, g.position, `${g.code}: position differs`);
      assert.equal(row.weekDue, g.weekDue, `${g.code}: due week differs`);
    }
  });

  test("284 keeps the gate record append-only and immutable", () => {
    /* A compliance certification whose record can be deleted or edited is not a
       control, it is a claim. Both triggers are named here so removing one fails
       in the suite rather than on the day somebody needs the evidence. */
    assert.match(SQL, /trg_ptg_no_delete/);
    assert.match(SQL, /trg_ptg_no_update/);
    assert.match(SQL, /partner_training_gates_no_delete/);
    assert.match(SQL, /partner_training_gates_no_update/);
  });

  test("284 puts the two partner-scoped tables behind row-level security", () => {
    // A partner reading another partner's gate record is the worst bug this
    // unit can produce. 045's helper enables, forces and installs the policy.
    assert.match(SQL, /fundhub_apply_partner_rls/);
    assert.match(SQL, /partner_training_progress/);
    assert.match(SQL, /partner_training_gates/);
  });

  test("284 stores no module content, and this test is the reason it stays that way", () => {
    /* Writing the teaching material for a regulated consumer-finance product is
       a human authoring job; a migration that grew a `body` column would be an
       invitation to fill it with something an agent made up.

       COMMENTS ARE STRIPPED FIRST, for the reason
       src/http/read-endpoints-org-scope.test.mjs states about the same trick:
       284's header says out loud that it holds no quiz engine and no video
       table, and matching raw source would fail the file for documenting the
       thing it refuses to do. Match the code; read the prose. */
    const code = SQL.replace(/--[^\n]*/g, " ");
    for (const forbidden of [/\bbody\s+text/i, /\bvideo_url\b/i, /\btranscript\b/i, /\bquiz\w*\s+(text|jsonb|uuid)/i]) {
      assert.ok(!forbidden.test(code),
        `284 has grown a content column (${forbidden}) — module content is authored by a human, not seeded`);
    }
  });
});

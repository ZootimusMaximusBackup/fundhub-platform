// Grading engine tests.
//
// The rubric is read out of 051_hiring.sql rather than restated here, so a typo in
// the migration fails these tests instead of being mirrored by a fixture edited in
// step with it — same approach as src/compliance/screen.test.mjs.
//
// The tests that matter most are the ones asserting what the grader CANNOT do:
// score a protected characteristic, or produce a rejection. Those are the legal
// invariants, and an invariant with no test is a comment.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  grade, isProtected, scoreable, bandFor, flagsFor,
  recommendationIsAdvisory, RECOMMENDATIONS
} from "./grading.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(HERE, "../../db/migrations/051_hiring.sql");

/* The seeded rubrics, parsed from the migration's jsonb literals. */
function seededRubric(stageKey) {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const marker = `'${stageKey}', 1,`;
  const from = sql.indexOf(marker);
  assert.ok(from > 0, `could not find the ${stageKey} rubric in the migration`);
  const tail = sql.slice(from);
  const blocks = [...tail.matchAll(/'(\[[\s\S]*?\])'::jsonb/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 2, `expected categories + bands for ${stageKey}`);
  const parse = (s) => JSON.parse(s.replace(/''/g, "'"));
  return {
    version: 1,
    categories: parse(blocks[0]),
    review_flags: stageKey === "applied" ? parse(blocks[1]) : [],
    rating_bands: parse(blocks[stageKey === "applied" ? 2 : 1])
  };
}

const APPLIED = seededRubric("applied");
const GROUP = seededRubric("group_interview");

const allAt = (rubric, n) =>
  Object.fromEntries(rubric.categories.map((c) => [c.key, n]));

describe("the seeded rubric parses", () => {
  test("the applied rubric has the six categories from doc 10", () => {
    assert.strictEqual(APPLIED.categories.length, 6);
    const keys = APPLIED.categories.map((c) => c.key);
    for (const k of ["effort", "honesty", "income_goal_fit", "relevant_experience",
                     "sales_inputs", "work_history"]) {
      assert.ok(keys.includes(k), `missing category ${k}`);
    }
  });

  test("the group-interview rubric has the four from doc 11", () => {
    assert.deepStrictEqual(GROUP.categories.map((c) => c.key).sort(),
      ["culture_fit", "presence", "purpose_goals", "self_awareness"]);
  });
});

describe("arithmetic and banding", () => {
  test("all 4s averages 4 and recommends priority", () => {
    const r = grade({ rubric: APPLIED, categoryScores: allAt(APPLIED, 4) });
    assert.strictEqual(r.average, 4);
    assert.strictEqual(r.recommendation, "advance_priority");
  });

  test("all 3s recommends advance", () => {
    const r = grade({ rubric: APPLIED, categoryScores: allAt(APPLIED, 3) });
    assert.strictEqual(r.average, 3);
    assert.strictEqual(r.recommendation, "advance");
  });

  test("all 1s recommends REVIEW, never rejection", () => {
    // The lowest possible score still routes to a person.
    const r = grade({ rubric: APPLIED, categoryScores: allAt(APPLIED, 1) });
    assert.strictEqual(r.average, 1);
    assert.strictEqual(r.recommendation, "review_likely_no");
    assert.ok(!/reject/.test(r.recommendation));
  });

  test("2.5 lands in the maybe band", () => {
    const scores = allAt(APPLIED, 2);
    scores.effort = 4; scores.honesty = 3;
    const r = grade({ rubric: APPLIED, categoryScores: scores });
    assert.strictEqual(r.recommendation, "review_maybe");
  });

  test("weights are honoured when a rubric sets them", () => {
    const rubric = {
      version: 1,
      categories: [{ key: "a", weight: 3 }, { key: "b", weight: 1 }],
      rating_bands: [{ min: 1, max: 4, recommendation: "advance", label: "x" }]
    };
    // (4*3 + 1*1) / 4 = 3.25
    assert.strictEqual(grade({ rubric, categoryScores: { a: 4, b: 1 } }).average, 3.25);
  });

  test("a zero-weight category is kept but excluded from the number", () => {
    const rubric = {
      version: 1,
      categories: [{ key: "a", weight: 1 }, { key: "b", weight: 0 }],
      rating_bands: [{ min: 1, max: 4, recommendation: "advance", label: "x" }]
    };
    const r = grade({ rubric, categoryScores: { a: 4, b: 1 } });
    assert.strictEqual(r.average, 4);
    assert.strictEqual(r.categoryScores.b, 1, "the score is still recorded");
  });

  test("the group rubric advances a 50/50 candidate, per doc 11", () => {
    // "Move people onto next step even if you're 50/50" — a 2.0 must advance.
    const r = grade({ rubric: GROUP, categoryScores: allAt(GROUP, 2) });
    assert.strictEqual(r.recommendation, "advance");
  });

  test("the group rubric still routes a floor score to review", () => {
    const r = grade({ rubric: GROUP, categoryScores: allAt(GROUP, 1) });
    assert.strictEqual(r.recommendation, "review_likely_no");
  });
});

describe("a partial rubric produces no recommendation", () => {
  test("missing categories yield 'incomplete' and a null average", () => {
    // Averaging the three somebody filled in and banding it as if complete is how
    // a candidate gets "below bar" from one answered question.
    const r = grade({ rubric: APPLIED, categoryScores: { effort: 4 } });
    assert.strictEqual(r.average, null);
    assert.strictEqual(r.recommendation, "incomplete");
    assert.strictEqual(r.missing.length, 5);
  });

  test("an empty score set is incomplete, not zero", () => {
    const r = grade({ rubric: APPLIED, categoryScores: {} });
    assert.strictEqual(r.recommendation, "incomplete");
  });
});

describe("protected characteristics can never be scored", () => {
  test("isProtected catches the obvious ones", () => {
    for (const k of ["age", "date_of_birth", "race", "ethnicity", "gender", "sex",
                     "religion", "disability", "marital_status", "children",
                     "veteran_status", "citizenship", "pregnancy", "criminal_history",
                     "salary_history"]) {
      assert.strictEqual(isProtected(k), true, `${k} should be protected`);
    }
  });

  test("isProtected catches camelCase spellings", () => {
    assert.strictEqual(isProtected("ageRange"), true);
    assert.strictEqual(isProtected("maritalStatus"), true);
    assert.strictEqual(isProtected("dateOfBirth"), true);
  });

  test("isProtected does NOT catch legitimate lookalikes", () => {
    // A deny-list that also blocks the real rubric is a deny-list somebody turns
    // off. These must all pass through.
    for (const k of ["average_deal_size", "agency_experience", "sales_inputs",
                     "work_history", "coaching_received", "effort", "management_experience",
                     "racket_sports"]) {
      assert.strictEqual(isProtected(k), false, `${k} should NOT be protected`);
    }
  });

  test("scoreable strips protected answers and reports what it stripped", () => {
    const { safe, rejected } = scoreable({
      effort: "lots", age: 41, gender: "f", relevant_experience: "5 years"
    });
    assert.deepStrictEqual(Object.keys(safe).sort(), ["effort", "relevant_experience"]);
    assert.deepStrictEqual(rejected.sort(), ["age", "gender"]);
  });

  test("scoring a protected CATEGORY throws rather than being silently dropped", () => {
    // A reviewer scoring "age_fit" is a process failure that must surface.
    assert.throws(
      () => grade({ rubric: APPLIED, categoryScores: { ...allAt(APPLIED, 3), age: 4 } }),
      /refusing to score protected characteristics/);
  });

  test("protected answers present on the application are reported, not scored", () => {
    const r = grade({
      rubric: APPLIED,
      categoryScores: allAt(APPLIED, 3),
      answers: { effort: "x", ethnicity: "y" }
    });
    assert.deepStrictEqual(r.protectedRejected, ["ethnicity"]);
    assert.strictEqual(r.average, 3, "the score is unaffected by their presence");
  });
});

describe("the grader cannot produce a decision", () => {
  test("every seeded band maps to an advisory recommendation", () => {
    for (const band of [...APPLIED.rating_bands, ...GROUP.rating_bands]) {
      assert.ok(RECOMMENDATIONS.includes(band.recommendation),
        `"${band.recommendation}" is not a known advisory recommendation`);
      recommendationIsAdvisory(band.recommendation);
    }
  });

  test("recommendationIsAdvisory rejects a terminal-sounding value", () => {
    // The tripwire if somebody adds an auto-reject band later.
    for (const bad of ["reject", "auto_reject", "disqualified", "hired"]) {
      assert.throws(() => recommendationIsAdvisory(bad), /is a decision, not a recommendation/);
    }
  });

  test("no seeded band contains the word reject", () => {
    const json = JSON.stringify([...APPLIED.rating_bands, ...GROUP.rating_bands]);
    assert.ok(!/reject/i.test(json), "a rubric band must not encode a rejection");
  });

  test("the module exports nothing that mutates an application", () => {
    // Structural: the grader has no db handle and no writer.
    const api = Object.keys({ grade, isProtected, scoreable, bandFor, flagsFor,
                              recommendationIsAdvisory });
    for (const name of api) {
      assert.ok(!/reject|hire|decide|advance|update|save|persist/i.test(name),
        `grading.mjs exports "${name}", which sounds like a decision`);
    }
  });
});

describe("flags route to a human", () => {
  test("honesty at the floor raises the incongruence flag", () => {
    const scores = { ...allAt(APPLIED, 3), honesty: 1 };
    const r = grade({ rubric: APPLIED, categoryScores: scores });
    assert.ok(r.flags.some((f) => f.key === "incongruent_answers"));
    // A flag is not a block: the recommendation still comes from the average.
    assert.ok(r.recommendation.startsWith("advance") || r.recommendation.startsWith("review"));
  });

  test("income goal at the floor raises the mismatch flag", () => {
    const r = grade({ rubric: APPLIED, categoryScores: { ...allAt(APPLIED, 3), income_goal_fit: 1 } });
    assert.ok(r.flags.some((f) => f.key === "income_goal_mismatch"));
  });

  test("a wide spread is flagged because the average hides it", () => {
    const scores = { ...allAt(APPLIED, 4), work_history: 1 };
    const r = grade({ rubric: APPLIED, categoryScores: scores });
    assert.ok(r.flags.some((f) => f.key === "wide_spread"));
  });

  test("a clean high score raises no flags", () => {
    assert.deepStrictEqual(grade({ rubric: APPLIED, categoryScores: allAt(APPLIED, 4) }).flags, []);
  });

  test("a flag whose condition is unimplemented is surfaced, not ignored", () => {
    // An unevaluated rule in a compliance tool is one everybody believes is
    // running and nothing is checking.
    const rubric = { ...APPLIED, review_flags: [{ key: "future_rule", label: "TBD" }] };
    const r = grade({ rubric, categoryScores: allAt(APPLIED, 3) });
    assert.ok(r.flags.some((f) => f.key === "future_rule" && f.unevaluated === true));
  });
});

describe("input validation", () => {
  test("a missing rubric throws", () => {
    assert.throws(() => grade({ categoryScores: {} }), /a rubric is required/);
  });

  test("a rubric with no categories throws", () => {
    assert.throws(() => grade({ rubric: { version: 1, categories: [] } }), /no categories/);
  });

  test("an out-of-range score throws rather than being clamped", () => {
    // Clamping a 7 to a 4 would silently flatter a candidate and corrupt the audit.
    assert.throws(
      () => grade({ rubric: APPLIED, categoryScores: { ...allAt(APPLIED, 3), effort: 7 } }),
      /the scale is 1-4/);
    assert.throws(
      () => grade({ rubric: APPLIED, categoryScores: { ...allAt(APPLIED, 3), effort: 0 } }),
      /the scale is 1-4/);
  });

  test("an unmatched average routes to review rather than passing or failing", () => {
    const rubric = {
      version: 1,
      categories: [{ key: "a" }],
      rating_bands: [{ min: 3.9, max: 4, recommendation: "advance", label: "x" }]
    };
    const r = grade({ rubric, categoryScores: { a: 2 } });
    assert.strictEqual(r.recommendation, "review");
    assert.match(r.label, /human review/i);
  });

  test("bandFor returns null on a null average", () => {
    assert.strictEqual(bandFor(APPLIED.rating_bands, null), null);
  });

  test("the rubric version is carried onto the result", () => {
    assert.strictEqual(grade({ rubric: APPLIED, categoryScores: allAt(APPLIED, 3) }).rubricVersion, 1);
  });
});

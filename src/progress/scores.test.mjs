// The score panels. Owner-set 2026-09-05: three personal bureaus plus business
// credit, business as an ARRAY with one entry per business.
//
// The claim these tests exist to defend is CLAUDE.md §12's: a bureau with no
// pull is null, and null survives every hop. A zero on a client's screen reads
// as a catastrophic score, and a blank reads as a low one.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  personalPanels, businessPanels, middleScore, scoreSeries, scoresOfResult,
  PERSONAL_BUREAUS, BUSINESS_BUREAU
} from "./scores.mjs";

function pull(at, { ex = null, eq = null, tu = null } = {}) {
  const scores = {};
  if (ex !== null) scores.ex = ex;
  if (eq !== null) scores.eq = eq;
  if (tu !== null) scores.tu = tu;
  return { id: `crs-${at}`, created_at: at, result: { scores } };
}

describe("personal panels", () => {
  test("a bureau that was never pulled is null, never zero and never blank", () => {
    const panels = personalPanels([pull("2026-03-01T00:00:00Z", { ex: 651, eq: 648 })]);
    const tu = panels.find((p) => p.bureau === "transunion");
    assert.strictEqual(tu.score, null);
    assert.strictEqual(tu.pulledAt, null);
    assert.notStrictEqual(tu.score, 0);
    assert.notStrictEqual(tu.score, "");
  });

  test("all three bureaus always get a panel, in a fixed order", () => {
    const panels = personalPanels([]);
    assert.deepEqual(panels.map((p) => p.bureau), [...PERSONAL_BUREAUS]);
    assert.deepEqual(panels.map((p) => p.score), [null, null, null]);
  });

  test("each bureau reports its own newest real score and its own pull date", () => {
    // TransUnion answered in January and went quiet; Experian answered in March.
    const panels = personalPanels([
      pull("2026-03-01T00:00:00Z", { ex: 651 }),
      pull("2026-01-12T00:00:00Z", { ex: 615, tu: 608 })
    ]);
    const by = Object.fromEntries(panels.map((p) => [p.bureau, p]));
    assert.equal(by.experian.score, 651);
    assert.equal(by.experian.pulledAt, "2026-03-01T00:00:00.000Z");
    assert.equal(by.transunion.score, 608);
    assert.equal(by.transunion.pulledAt, "2026-01-12T00:00:00.000Z");
    assert.strictEqual(by.equifax.score, null);
  });

  test("a sandbox fixture is never painted as somebody's credit file", () => {
    const sandbox = {
      created_at: "2026-03-01T00:00:00Z",
      result: { environment: "sandbox", scores: { ex: 800, eq: 800, tu: 800 } }
    };
    assert.deepEqual(scoresOfResult(sandbox),
      { experian: null, equifax: null, transunion: null });
    assert.deepEqual(personalPanels([sandbox]).map((p) => p.score), [null, null, null]);
  });

  test("the report link is carried only on a panel that has a score", () => {
    const panels = personalPanels([pull("2026-03-01T00:00:00Z", { ex: 651 })],
      { reportDocumentId: "doc-1" });
    const by = Object.fromEntries(panels.map((p) => [p.bureau, p]));
    assert.equal(by.experian.reportDocumentId, "doc-1");
    assert.strictEqual(by.equifax.reportDocumentId, null);
  });
});

describe("business panels", () => {
  const one = {
    id: "biz-1", name: "Sim Five Holdings LLC", updated_at: "2026-03-01T00:00:00Z",
    entity_data: { scores: { intelliscore: 42 } }
  };
  const two = {
    id: "biz-2", name: "Second Venture LLC", updated_at: "2026-02-01T00:00:00Z",
    entity_data: { commercialScore: { score: 71 } }
  };

  test("no business on file means an empty array, not a placeholder panel", () => {
    assert.deepEqual(businessPanels([]), []);
    assert.deepEqual(businessPanels(undefined), []);
  });

  test("two businesses give two panels, each keyed on its own row id", () => {
    const panels = businessPanels([one, two]);
    assert.equal(panels.length, 2);
    assert.deepEqual(panels.map((p) => p.businessId), ["biz-1", "biz-2"]);
    assert.deepEqual(panels.map((p) => p.score), [42, 71]);
    assert.deepEqual(panels.map((p) => p.bureau), [BUSINESS_BUREAU, BUSINESS_BUREAU]);
  });

  /* THE ROW-EDIT TIMESTAMP IS NOT A PULL DATE.
     `businesses.updated_at` is written by a database trigger on EVERY update to
     the row, so this used to repaint a client's business score as freshly pulled
     the moment anybody edited the address. `businesses` carries no per-score
     timestamp at all, so the honest answer is null. */
  test("a business score NEVER carries a pull date, because none is stored", () => {
    const edited = { ...one, updated_at: "2026-09-05T10:00:00Z" };
    const panels = businessPanels([edited], { reportDocumentId: "doc-9" });
    assert.equal(panels[0].score, 42, "the score itself is still read");
    assert.strictEqual(panels[0].pulledAt, null,
      "updated_at is when the row was edited, not when a score was pulled");
  });

  test("editing the business row does not change what the panel says was pulled", () => {
    const before = businessPanels([{ ...one, updated_at: "2026-01-01T00:00:00Z" }]);
    const after = businessPanels([{ ...one, updated_at: "2026-09-05T10:00:00Z" }]);
    assert.strictEqual(before[0].pulledAt, after[0].pulledAt);
    assert.strictEqual(after[0].pulledAt, null);
  });

  test("created_at is not substituted for the missing pull date either", () => {
    const panels = businessPanels([{ ...one, created_at: "2026-02-02T00:00:00Z" }]);
    assert.strictEqual(panels[0].pulledAt, null);
  });

  test("the business id is the primary key, so it is stable across two reads", () => {
    const a = businessPanels([one, two]).map((p) => p.businessId);
    const b = businessPanels([one, two]).map((p) => p.businessId);
    assert.deepEqual(a, b);
    // And it is not the ordinal: reversing the input keeps each id on its row.
    const rev = businessPanels([two, one]);
    assert.equal(rev[0].businessId, "biz-2");
    assert.equal(rev[0].score, 71);
  });

  test("a business with no score is a panel reading null, with no pull date", () => {
    const panels = businessPanels([{ id: "biz-3", name: "No Score Co", entity_data: {} }],
      { reportDocumentId: "doc-9" });
    assert.strictEqual(panels[0].score, null);
    assert.strictEqual(panels[0].pulledAt, null);
    assert.strictEqual(panels[0].reportDocumentId, null);
    assert.equal(panels[0].name, "No Score Co");
  });

  test("a score outside the 0-100 business scale is refused, not clamped", () => {
    const panels = businessPanels([
      { id: "b", name: "X", entity_data: { scores: { intelliscore: 650 } } }
    ]);
    assert.strictEqual(panels[0].score, null);
  });
});

describe("middle score", () => {
  test("three scores give the middle one", () => {
    assert.equal(middleScore({ experian: 651, equifax: 648, transunion: 608 }), 648);
  });

  test("fewer than three is unknown, not the lower of two", () => {
    assert.strictEqual(middleScore({ experian: 651, equifax: 648, transunion: null }), null);
    assert.strictEqual(middleScore({ experian: 651, equifax: null, transunion: null }), null);
    assert.strictEqual(middleScore({}), null);
  });
});

describe("score series", () => {
  test("oldest first, one point per pull that produced a score", () => {
    const s = scoreSeries([
      pull("2026-03-01T00:00:00Z", { ex: 651, eq: 648 }),
      pull("2026-01-12T00:00:00Z", { ex: 615, eq: 612, tu: 608 })
    ]);
    assert.equal(s.length, 2);
    assert.equal(s[0].at, "2026-01-12T00:00:00.000Z");
    assert.equal(s[1].at, "2026-03-01T00:00:00.000Z");
    assert.strictEqual(s[1].transunion, null);
  });

  test("a tombstoned pull draws no point rather than a point of three nulls", () => {
    // src/retention/classes.mjs empties crs_results.result after the window.
    const s = scoreSeries([
      { created_at: "2025-06-01T00:00:00Z", result: null },
      pull("2026-01-12T00:00:00Z", { ex: 615, eq: 612, tu: 608 })
    ]);
    assert.equal(s.length, 1);
    assert.equal(s[0].at, "2026-01-12T00:00:00.000Z");
  });

  test("no pulls is an empty series, not a fabricated starting point", () => {
    assert.deepEqual(scoreSeries([]), []);
  });
});

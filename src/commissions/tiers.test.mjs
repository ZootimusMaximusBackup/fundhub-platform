import { test } from "node:test";
import assert from "node:assert";
import { tierFor, computeTiered, sortTiers } from "./tiers.mjs";
import { toCents } from "./money.mjs";

// Arbitrary fixture ladder — these are not Fundhub's rates, they are rows.
const LADDER = [
  { id: "t1", min_amount: 0,     max_amount: 25000, percent: 0.25 },
  { id: "t2", min_amount: 25000, max_amount: 50000, percent: 0.5 },
  { id: "t3", min_amount: 50000, max_amount: null,  percent: 1 }
];

test("sortTiers: input order is not trusted", () => {
  const shuffled = [LADDER[2], LADDER[0], LADDER[1]];
  assert.deepEqual(sortTiers(shuffled).map((t) => t.id), ["t1", "t2", "t3"]);
});

test("tierFor: brackets are [min, max) — a boundary belongs to the upper bracket", () => {
  assert.equal(tierFor(LADDER, toCents(0)).id, "t1");
  assert.equal(tierFor(LADDER, toCents(24999)).id, "t1");
  assert.equal(tierFor(LADDER, toCents(25000)).id, "t2", "exactly on the boundary moves up");
  assert.equal(tierFor(LADDER, toCents(50000)).id, "t3");
  assert.equal(tierFor(LADDER, toCents(999999)).id, "t3", "top bracket has no ceiling");
});

test("tierFor: a hole in the ladder returns null rather than the nearest guess", () => {
  const gapped = [
    { id: "a", min_amount: 0, max_amount: 1000, percent: 1 },
    { id: "b", min_amount: 5000, max_amount: null, percent: 2 }
  ];
  assert.equal(tierFor(gapped, toCents(3000)), null);
});

test("computeTiered whole: the entire base pays at the matching bracket's rate", () => {
  // $60,000 lands in the 1% bracket -> 1% of the whole $60,000.
  assert.equal(computeTiered(LADDER, toCents(60000), "whole"), toCents(600));
  // $30,000 lands in the 0.5% bracket -> 0.5% of the whole $30,000.
  assert.equal(computeTiered(LADDER, toCents(30000), "whole"), toCents(150));
});

test("computeTiered marginal: each bracket pays on its own slice", () => {
  // $60,000 = 25,000@0.25% (62.50) + 25,000@0.5% (125.00) + 10,000@1% (100.00)
  assert.equal(computeTiered(LADDER, toCents(60000), "marginal"), toCents(287.5));
});

test("computeTiered defaults to marginal — no cliff at a bracket boundary", () => {
  assert.equal(computeTiered(LADDER, toCents(60000)),
               computeTiered(LADDER, toCents(60000), "marginal"));
});

test("marginal has no cliff: one dollar more funded does not jump the whole commission", () => {
  const justUnder = computeTiered(LADDER, toCents(49999));
  const justOver = computeTiered(LADDER, toCents(50001));
  assert.ok(justOver - justUnder < toCents(1),
    `a $2 swing in funding moved commission by ${(justOver - justUnder) / 100}`);

  // The same two numbers under 'whole' jump by hundreds — that is the cliff.
  const wholeUnder = computeTiered(LADDER, toCents(49999), "whole");
  const wholeOver = computeTiered(LADDER, toCents(50001), "whole");
  assert.ok(wholeOver - wholeUnder > toCents(200));
});

test("computeTiered marginal and whole genuinely differ — the mode is not cosmetic", () => {
  assert.notEqual(
    computeTiered(LADDER, toCents(60000), "whole"),
    computeTiered(LADDER, toCents(60000), "marginal")
  );
});

test("computeTiered: base outside every bracket pays nothing, no silent fallback", () => {
  const highOnly = [{ id: "x", min_amount: 100000, max_amount: null, percent: 5 }];
  assert.equal(computeTiered(highOnly, toCents(1000), "whole"), 0);
});

test("computeTiered: an empty ladder pays nothing", () => {
  assert.equal(computeTiered([], toCents(50000), "whole"), 0);
});

test("computeTiered whole: a flat bracket pays its flat amount", () => {
  const flatLadder = [
    { id: "f1", min_amount: 0, max_amount: 3000, flat_amount: 250 },
    { id: "f2", min_amount: 3000, max_amount: null, flat_amount: 500 }
  ];
  assert.equal(computeTiered(flatLadder, toCents(3000), "whole"), toCents(500));
  assert.equal(computeTiered(flatLadder, toCents(100), "whole"), toCents(250));
});

test("computeTiered marginal: a flat amount inside a marginal ladder is rejected, not guessed", () => {
  const bad = [{ id: "b", min_amount: 0, max_amount: null, flat_amount: 100 }];
  assert.throws(() => computeTiered(bad, toCents(5000), "marginal"), /marginal tiers must use percent/);
});

test("computeTiered: an unknown mode throws rather than defaulting", () => {
  assert.throws(() => computeTiered(LADDER, toCents(1000), "sideways"), /unknown tier_mode/);
});

test("computeTiered: a negative base (reversal) mirrors the positive result exactly", () => {
  assert.equal(
    computeTiered(LADDER, toCents(-60000), "whole"),
    -computeTiered(LADDER, toCents(60000), "whole")
  );
});

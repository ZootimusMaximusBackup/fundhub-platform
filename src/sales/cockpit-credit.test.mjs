// Cockpit credit block must use the same FICO extraction as CCP (triMerge).
import { test } from "node:test";
import assert from "node:assert/strict";
import { triMerge } from "../http/client-detail.mjs";

test("CRS ex/eq/tu scores become experian/equifax/transunion via triMerge", () => {
  const row = {
    created_at: "2026-08-19T22:58:47.386Z",
    result: {
      scores: { ex: 718, eq: 724, tu: 731 },
      environment: "production"
    }
  };
  const merge = triMerge([row]);
  assert.equal(merge.experian, 718);
  assert.equal(merge.equifax, 724);
  assert.equal(merge.transunion, 731);
  // Closer paint reads these names — not ex/eq/tu.
  const scores = {
    experian: merge.experian,
    equifax: merge.equifax,
    transunion: merge.transunion
  };
  assert.equal(scores.experian, 718);
  assert.equal(scores.EX, undefined);
});

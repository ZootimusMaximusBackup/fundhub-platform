import { test } from "node:test";
import assert from "node:assert/strict";
import { attachGateToRound } from "./gate.mjs";

function fakeDb({ activeCases = [], everHadCase = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ");
      calls.push(s);
      if (s.includes("FROM inquiry_removal_cases") && s.includes("case_status")) {
        return { rows: activeCases };
      }
      if (s.includes("FROM inquiry_removal_cases") && s.includes("LIMIT 1")) {
        return { rows: everHadCase ? [{ "?column?": 1 }] : [] };
      }
      if (s.includes("UPDATE funding_rounds")) {
        return { rows: [] };
      }
      if (s.includes("FROM pipeline_stages") || s.includes("FROM cards") || s.includes("INSERT INTO cards")) {
        throw new Error("must not write an inquiry card");
      }
      return { rows: [] };
    }
  };
}

test("attachGateToRound does not write Resume Funding when there is no inquiry case", async () => {
  const db = fakeDb({ activeCases: [], everHadCase: false });
  const out = await attachGateToRound(db, {
    orgId: "org-1",
    clientId: "client-1",
    fundingRoundId: "round-1"
  });
  assert.equal(out.status.hot.length, 0);
  assert.equal(
    db.calls.some((s) => s.includes("FROM pipeline_stages") || s.includes("INSERT INTO cards")),
    false
  );
});

test("attachGateToRound parks Resume Funding when a prior inquiry case exists", async () => {
  let moved = false;
  const db = {
    async query(sql) {
      const s = String(sql).replace(/\s+/g, " ");
      if (s.includes("FROM inquiry_removal_cases") && s.includes("case_status")) {
        return { rows: [] };
      }
      if (s.includes("FROM inquiry_removal_cases") && s.includes("LIMIT 1")) {
        return { rows: [{ "?column?": 1 }] };
      }
      if (s.includes("UPDATE funding_rounds")) {
        return { rows: [] };
      }
      if (s.includes("FROM pipeline_stages")) {
        moved = true;
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  await attachGateToRound(db, {
    orgId: "org-1",
    clientId: "client-1",
    fundingRoundId: "round-1"
  });
  assert.equal(moved, true);
});

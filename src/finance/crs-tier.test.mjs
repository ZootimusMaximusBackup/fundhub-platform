import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { mergeBureauReports } from "./crs-map.mjs";
import {
  OUTCOME_TIERS,
  isKnownOutcomeTier,
  stampOutcomeTier,
  rawResponsesFromMerged,
  runTierEngineFromCrsResult,
  submittedNameFromIdentity,
  submittedAddressFromIdentity
} from "./crs-tier.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX = path.resolve(HERE, "../../vendor/underwriteiq-full/api/lite/crs/sandbox");

function loadSandbox(name) {
  return JSON.parse(readFileSync(path.join(SANDBOX, name), "utf8"));
}

function mergedFromSandbox() {
  return mergeBureauReports({
    reports: {
      TU: loadSandbox("tu.json"),
      EX: loadSandbox("exp.json"),
      EQ: loadSandbox("efx.json")
    },
    requestIds: { TU: "tu-1", EX: "ex-1", EQ: "eq-1" },
    environment: "sandbox"
  });
}

test("rawResponsesFromMerged unwraps bureaus.TU|EX|EQ in pull order", () => {
  const merged = mergedFromSandbox();
  const raw = rawResponsesFromMerged(merged);
  assert.equal(raw.length, 3);
  assert.equal(raw[0], merged.bureaus.TU);
  assert.equal(raw[1], merged.bureaus.EX);
  assert.equal(raw[2], merged.bureaus.EQ);
  assert.ok(raw[0].repositoryIncluded.transunion);
});

test("rawResponsesFromMerged throws when there are zero bureau reports", () => {
  assert.throws(
    () => rawResponsesFromMerged({ bureausPulled: ["TU"], bureaus: {} }),
    /no bureau reports to score/
  );
});

test("runTierEngineFromCrsResult scores sandbox Softview bodies without re-flattening", () => {
  const merged = mergedFromSandbox();
  const flatTradelinesBefore = merged.tradelines.length;
  const result = runTierEngineFromCrsResult(merged, {
    submittedName: "BARBARA M DOTY",
    submittedAddress: "1100 LYNHURST LN, DENTON, TX 762058006"
  });
  assert.equal(result.ok, true);
  assert.ok(result.outcome, "engine must return a non-null tier");
  assert.equal(typeof result.outcome, "string");
  assert.equal(merged.tradelines.length, flatTradelinesBefore,
    "adapter must not rewrite Fundhub flat tradelines");
});

test("runTierEngineFromCrsResult is idempotent on the same merged payload", () => {
  const merged = mergedFromSandbox();
  const a = runTierEngineFromCrsResult(merged, { submittedName: "BARBARA M DOTY" });
  const b = runTierEngineFromCrsResult(merged, { submittedName: "BARBARA M DOTY" });
  assert.equal(a.outcome, b.outcome);
  assert.equal(a.preapprovals?.totalCombined, b.preapprovals?.totalCombined);
});

test("identity format helpers", () => {
  assert.equal(submittedNameFromIdentity({ firstName: "Ada", lastName: "Lovelace" }), "Ada Lovelace");
  assert.equal(
    submittedAddressFromIdentity({
      addresses: [{ addressLine1: "1 Main", city: "Austin", state: "TX", postalCode: "78701" }]
    }),
    "1 Main, Austin, TX, 78701"
  );
});

const SCORED = {
  bureausPulled: ["TU"],
  bureaus: { TU: { scores: [{ score: 720 }], tradelines: [{ creditorName: "BANK" }] } }
};

function engineGuess(outcome, extra = {}) {
  return () => ({ ok: true, outcome, preapprovals: { totalCombined: 1 }, ...extra });
}

const KNOWN_TIERS = [
  "FRAUD_HOLD",
  "MANUAL_REVIEW",
  "REPAIR_ONLY",
  "FUNDING_PLUS_REPAIR",
  "FULL_FUNDING",
  "PREMIUM_STACK"
];

test("OUTCOME_TIERS is the six-tier ladder and nothing else", () => {
  assert.deepEqual([...OUTCOME_TIERS], KNOWN_TIERS);
  for (const tier of KNOWN_TIERS) assert.equal(isKnownOutcomeTier(tier), true);
  assert.equal(isKnownOutcomeTier("full_funding"), false);
  assert.equal(isKnownOutcomeTier(" FULL_FUNDING "), false);
  assert.equal(isKnownOutcomeTier("FUNDING"), false);
});

// Winner: exact known stamp always wins. This test must fail if that flips.
test("stamp wins over engine guess for every known tier pair", () => {
  for (const stamp of KNOWN_TIERS) {
    for (const guess of KNOWN_TIERS) {
      assert.equal(
        stampOutcomeTier(guess, stamp),
        stamp,
        `stamp ${stamp} must beat engine ${guess}`
      );
    }
  }
});

test("engine guess wins only when stamp is missing or not an exact known name", () => {
  assert.equal(stampOutcomeTier("FULL_FUNDING", null), "FULL_FUNDING");
  assert.equal(stampOutcomeTier("REPAIR_ONLY", undefined), "REPAIR_ONLY");
  assert.equal(stampOutcomeTier("MANUAL_REVIEW", ""), "MANUAL_REVIEW");
  assert.equal(stampOutcomeTier("FULL_FUNDING", "full_funding"), "FULL_FUNDING");
  assert.equal(stampOutcomeTier("FULL_FUNDING", " FULL_FUNDING "), "FULL_FUNDING");
  assert.equal(stampOutcomeTier("PREMIUM_STACK", "FUNDING"), "PREMIUM_STACK");
});

test("funding sample stamp is not MANUAL_REVIEW when engine guesses review", () => {
  for (const stamp of ["FULL_FUNDING", "FUNDING_PLUS_REPAIR", "PREMIUM_STACK"]) {
    const out = runTierEngineFromCrsResult(SCORED, { outcomeTier: stamp }, {
      runEngine: engineGuess("MANUAL_REVIEW")
    });
    assert.equal(out.outcome, stamp);
    assert.equal(out.outcomeSource, "stamp");
    assert.notEqual(out.outcome, "MANUAL_REVIEW");
  }
});

test("MANUAL_REVIEW stamp stays review when engine guesses funding", () => {
  const out = runTierEngineFromCrsResult(SCORED, { outcomeTier: "MANUAL_REVIEW" }, {
    runEngine: engineGuess("FULL_FUNDING")
  });
  assert.equal(out.outcome, "MANUAL_REVIEW");
  assert.equal(out.outcomeSource, "stamp");
});

test("FRAUD_HOLD stamp stays hold when engine guesses funding", () => {
  const out = runTierEngineFromCrsResult(SCORED, { outcomeTier: "FRAUD_HOLD" }, {
    runEngine: engineGuess("PREMIUM_STACK")
  });
  assert.equal(out.outcome, "FRAUD_HOLD");
});

test("null or empty CRS result does not throw and is not FULL_FUNDING", () => {
  for (const payload of [null, undefined, {}, { bureaus: {} }, { bureausPulled: [], bureaus: {} }]) {
    const out = runTierEngineFromCrsResult(payload);
    assert.equal(out.outcome, "MANUAL_REVIEW", `payload ${JSON.stringify(payload)}`);
    assert.notEqual(out.outcome, "FULL_FUNDING");
    assert.equal(out.ok, false);
    assert.equal(out.outcomeSource, "fail_closed");
  }
});

test("null CRS with funding stamp still stamps funding (samples)", () => {
  const out = runTierEngineFromCrsResult(null, { outcomeTier: "FULL_FUNDING" });
  assert.equal(out.outcome, "FULL_FUNDING");
  assert.equal(out.outcomeSource, "stamp");
});

test("missing scores and tradelines fail closed to MANUAL_REVIEW", () => {
  const emptyFile = {
    bureausPulled: ["TU"],
    bureaus: { TU: { scores: [], tradelines: [] } }
  };
  const out = runTierEngineFromCrsResult(emptyFile, {}, {
    runEngine: engineGuess("FULL_FUNDING")
  });
  assert.equal(out.outcome, "MANUAL_REVIEW");
  assert.notEqual(out.outcome, "FULL_FUNDING");
  assert.equal(out.reason, "missing_scores_or_tradelines");
});

test("missing scores and tradelines still honor a funding stamp", () => {
  const emptyFile = {
    bureausPulled: ["TU"],
    bureaus: { TU: { scores: [], tradelines: [] } }
  };
  const out = runTierEngineFromCrsResult(
    emptyFile,
    { outcomeTier: "FUNDING_PLUS_REPAIR" },
    { runEngine: engineGuess("MANUAL_REVIEW") }
  );
  assert.equal(out.outcome, "FUNDING_PLUS_REPAIR");
  assert.equal(out.outcomeSource, "stamp");
});

test("missing tradelines but present scores still uses the engine guess", () => {
  const scoresOnly = {
    bureausPulled: ["TU"],
    bureaus: { TU: { scores: [{ score: 701 }], tradelines: [] } }
  };
  const out = runTierEngineFromCrsResult(scoresOnly, {}, {
    runEngine: engineGuess("REPAIR_ONLY")
  });
  assert.equal(out.outcome, "REPAIR_ONLY");
  assert.equal(out.outcomeSource, "engine");
});

test("engine throw or no outcome fail closed, not FULL_FUNDING", () => {
  const threw = runTierEngineFromCrsResult(SCORED, {}, {
    runEngine: () => { throw new Error("boom"); }
  });
  assert.equal(threw.outcome, "MANUAL_REVIEW");
  assert.equal(threw.reason, "engine_threw");

  const noOutcome = runTierEngineFromCrsResult(SCORED, {}, {
    runEngine: () => ({ ok: true })
  });
  assert.equal(noOutcome.outcome, "MANUAL_REVIEW");

  const unknown = runTierEngineFromCrsResult(SCORED, {}, {
    runEngine: engineGuess("KINDA_FUNDED")
  });
  assert.equal(unknown.outcome, "MANUAL_REVIEW");
  assert.equal(isKnownOutcomeTier(unknown.outcome) && unknown.outcome !== "KINDA_FUNDED", true);
});

test("garbage strings and SQL-looking input do not throw and are not FULL_FUNDING", () => {
  const garbage = [
    "SELECT * FROM crs_results",
    "'; DROP TABLE clients;--",
    "FULL_FUNDING; DROP TABLE crs_results;--",
    12,
    [],
    { bureausPulled: "TU; DROP TABLE", bureaus: "SELECT 1" },
    { bureausPulled: ["TU"], bureaus: { TU: "'; DROP TABLE--" } }
  ];
  for (const payload of garbage) {
    const out = runTierEngineFromCrsResult(payload);
    assert.equal(typeof out.outcome, "string");
    assert.notEqual(out.outcome, "FULL_FUNDING", `payload ${String(payload)}`);
    assert.equal(isKnownOutcomeTier(out.outcome), true);
  }

  const sqlStamp = runTierEngineFromCrsResult(SCORED, {
    outcomeTier: "FULL_FUNDING; DROP TABLE crs_results;--",
    submittedName: "'; DROP TABLE clients;--"
  }, { runEngine: engineGuess("REPAIR_ONLY") });
  assert.equal(sqlStamp.outcome, "REPAIR_ONLY");
  assert.equal(sqlStamp.outcomeSource, "engine");
});

test("identity helpers swallow garbage without throwing", () => {
  assert.equal(submittedNameFromIdentity(null), "");
  assert.equal(submittedNameFromIdentity("'; DROP TABLE--"), "");
  assert.equal(submittedAddressFromIdentity([]), "");
  assert.equal(submittedAddressFromIdentity({ addresses: "SELECT 1" }), "");
});

test("existing caller shape still returns ok + outcome + preapprovals", () => {
  const out = runTierEngineFromCrsResult(SCORED, {
    submittedName: "BARBARA M DOTY",
    submittedAddress: "1100 LYNHURST LN"
  }, { runEngine: engineGuess("FULL_FUNDING") });
  assert.equal(out.ok, true);
  assert.equal(out.outcome, "FULL_FUNDING");
  assert.equal(out.preapprovals.totalCombined, 1);
  assert.equal(out.outcomeSource, "engine");
});

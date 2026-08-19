import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { mergeBureauReports } from "./crs-map.mjs";
import {
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
  assert.throws(
    () => runTierEngineFromCrsResult({ bureausPulled: [], bureaus: {} }),
    /no bureau reports to score/
  );
});

// The shape that actually broke the demo funding pack on 2026-08-18: a stored
// pull carrying flat tradelines and NO `bureaus` / `bureausPulled` keys at all.
// It looks like a complete payload, which is why it went unnoticed, so it is
// worth pinning separately from the empty-map case above.
test("a stored pull with flat tradelines but no bureaus key still throws", () => {
  assert.throws(
    () => rawResponsesFromMerged({
      outcome: "FULL_FUNDING",
      tradelines: [{ creditorName: "Chase Sapphire Preferred", bureau: "EX" }]
    }),
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

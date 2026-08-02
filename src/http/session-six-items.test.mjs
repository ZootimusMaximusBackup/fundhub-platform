import test from "node:test";
import assert from "node:assert/strict";
import { askPlatformHelp, listPlatformHelp } from "../chat/platform-help.mjs";
import { _pairKeyForTests } from "../chat/internal.mjs";
import { buildSimulatedCrsPayload, DEMO_EMAIL_DOMAIN } from "../demo/simulate-client.mjs";
import { extractTradelineRecords, normalizeFromCrs } from "../tradelines/index.mjs";

test("platform help answers a known how-to without fabricating", () => {
  const r = askPlatformHelp("how do I send a contract?");
  assert.equal(r.ok, true);
  assert.equal(r.thin, false);
  assert.match(r.answer, /contract/i);
  assert.ok(r.sources.length >= 1);
});

test("platform help stays honest on unknown questions", () => {
  const r = askPlatformHelp("xyzzyplugh unrelated gibberish zz9pluralzalpha");
  assert.equal(r.ok, true);
  assert.equal(r.thin, true);
  assert.match(r.answer, /do not have a documented answer/i);
});

test("platform help list is non-empty", () => {
  assert.ok(listPlatformHelp().length >= 5);
});

test("internal pair key is order-independent", () => {
  const a = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const b = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  assert.equal(_pairKeyForTests(a, b), _pairKeyForTests(b, a));
});

test("simulated CRS payload uses real bureau field names the normalizer reads", () => {
  const payload = buildSimulatedCrsPayload({
    email: `sim+1@${DEMO_EMAIL_DOMAIN}`,
    name: "Simulated Client"
  });
  const records = extractTradelineRecords(payload);
  assert.ok(records.length >= 3);
  assert.ok(records.every((r) => r.creditorName && r.accountIdentifier));
  const rows = normalizeFromCrs({
    id: "00000000-0000-0000-0000-000000000001",
    org_id: "00000000-0000-0000-0000-000000000002",
    client_id: "00000000-0000-0000-0000-000000000003",
    result: payload,
    created_at: new Date().toISOString()
  });
  assert.ok(rows.length >= 3);
  assert.ok(rows.some((r) => /Chase/i.test(r.lender)));
  assert.ok(rows.every((r) => r.source === "crs"));
});

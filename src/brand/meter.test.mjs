import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TOKEN_CAP, SUITE_OFF, CAP_HIT,
  canAccessPartnerMarketing, isOwner,
  loadSuiteSettings, assertSuiteEnabled, remainingTokens, assertUnderCap, setSuiteEnabled
} from "./meter.mjs";

const PID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function fakeDb(rows) {
  return {
    query: async (sql, params) => {
      for (const [re, out] of rows) {
        if (re.test(sql)) return typeof out === "function" ? out(params, sql) : out;
      }
      throw new Error("unexpected sql: " + sql);
    }
  };
}

describe("canAccessPartnerMarketing", () => {
  test("owning partner may read their own id", () => {
    assert.equal(canAccessPartnerMarketing({ kind: "partner", partnerId: PID }, PID), true);
  });
  test("a partner may not read another partner", () => {
    assert.equal(canAccessPartnerMarketing({
      kind: "partner", partnerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    }, PID), false);
  });
  test("owner and admin staff may", () => {
    assert.equal(canAccessPartnerMarketing({ kind: "staff", role: "owner", staff: { role: "owner" } }, PID), true);
    assert.equal(canAccessPartnerMarketing({ kind: "staff", staff: { role: "admin" } }, PID), true);
  });
  test("a closer may not", () => {
    assert.equal(canAccessPartnerMarketing({ kind: "staff", staff: { role: "closer" } }, PID), false);
  });
});

describe("isOwner", () => {
  test("only a staff owner", () => {
    assert.equal(isOwner({ kind: "staff", role: "owner" }), true);
    assert.equal(isOwner({ kind: "staff", staff: { role: "admin" } }), false);
    assert.equal(isOwner({ kind: "partner", partnerId: PID, role: "owner" }), false);
  });
});

describe("suite switch and cap", () => {
  test("missing settings row is off with the default cap", async () => {
    const db = fakeDb([
      [/FROM partner_module_settings/i, { rows: [] }],
      [/SELECT org_id FROM partners/i, { rows: [{ org_id: ORG }] }]
    ]);
    const s = await loadSuiteSettings(db, PID);
    assert.equal(s.enabled, false);
    assert.equal(s.cap, DEFAULT_TOKEN_CAP);
    assert.equal(s.orgId, ORG);
  });

  test("assertSuiteEnabled throws SUITE_OFF when the switch is off", async () => {
    const db = fakeDb([
      [/FROM partner_module_settings/i, { rows: [{ marketing_suite_enabled: false, ai_token_cap_monthly: 250000, org_id: ORG }] }]
    ]);
    await assert.rejects(() => assertSuiteEnabled(db, PID), (err) => err.code === SUITE_OFF);
  });

  test("assertUnderCap throws CAP_HIT when used meets the cap", async () => {
    const db = fakeDb([
      [/FROM partner_module_settings/i, { rows: [{ marketing_suite_enabled: true, ai_token_cap_monthly: 10, org_id: ORG }] }],
      [/FROM partner_ai_usage/i, { rows: [{ used: 10 }] }]
    ]);
    await assert.rejects(() => assertUnderCap(db, PID), (err) => {
      assert.equal(err.code, CAP_HIT);
      assert.equal(err.usage.remaining, 0);
      return true;
    });
  });

  test("remainingTokens subtracts this month's use from the cap", async () => {
    const db = fakeDb([
      [/FROM partner_module_settings/i, { rows: [{ marketing_suite_enabled: true, ai_token_cap_monthly: 250000, org_id: ORG }] }],
      [/FROM partner_ai_usage/i, { rows: [{ used: 40 }] }]
    ]);
    const snap = await remainingTokens(db, PID);
    assert.equal(snap.enabled, true);
    assert.equal(snap.used, 40);
    assert.equal(snap.remaining, 249960);
  });

  test("setSuiteEnabled writes the owner switch", async () => {
    const db = fakeDb([
      [/INSERT INTO partner_module_settings/i, { rows: [{ marketing_suite_enabled: true, ai_token_cap_monthly: 250000 }] }]
    ]);
    const out = await setSuiteEnabled(db, { orgId: ORG, partnerId: PID, enabled: true });
    assert.equal(out.enabled, true);
    assert.equal(out.cap, DEFAULT_TOKEN_CAP);
  });
});

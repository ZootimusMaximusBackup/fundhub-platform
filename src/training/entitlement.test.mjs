// Who may open the $10,000 training — the decisions, without a database.
//
// entitlement.mjs writes one query and then decides. These prove the decisions:
// which facts are read, which refusal each state produces, and that an unscoped
// call is refused rather than answered.
//
// The stub returns whatever partner row the case wants. The real query is proved
// against Postgres in training.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  trainingAccessFor, assertTrainingAccess, TrainingAccessError,
  accessMessage, ACCESS_REASONS
} from "./entitlement.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";

/** A db stub that answers the one query this module makes. */
function stub(row, capture = []) {
  return {
    query: async (sql, params) => {
      capture.push({ sql, params });
      return { rows: row ? [row] : [] };
    }
  };
}

const active = { id: PARTNER, status: "active", agreement_signed_at: "2026-08-20T00:00:00.000Z" };

describe("training entitlement", () => {
  test("an active partner with a signed agreement is in", async () => {
    const access = await trainingAccessFor(stub(active), { orgId: ORG, partnerId: PARTNER });
    assert.strictEqual(access.allowed, true);
    assert.strictEqual(access.reason, null);
    assert.strictEqual(access.partnerStatus, "active");
  });

  test("no partner row is 'no_partner', not a crash and not a pass", async () => {
    const access = await trainingAccessFor(stub(null), { orgId: ORG, partnerId: PARTNER });
    assert.strictEqual(access.allowed, false);
    assert.strictEqual(access.reason, "no_partner");
    // Deliberately indistinguishable from "belongs to another company" — telling
    // a caller that a partner exists but is not theirs is itself a disclosure.
    assert.strictEqual(access.partnerStatus, null);
  });

  test("an invited or paused partner is out, and the reason says which problem it is", async () => {
    for (const status of ["invited", "paused"]) {
      const access = await trainingAccessFor(
        stub({ ...active, status }), { orgId: ORG, partnerId: PARTNER });
      assert.strictEqual(access.allowed, false);
      assert.strictEqual(access.reason, "partner_not_active");
      assert.strictEqual(access.partnerStatus, status);
    }
  });

  test("an unsigned agreement is its own refusal", async () => {
    /* This is the 042 payout hold read as an access rule: the same stamp that
       has to exist before a partner can be paid is the one that says somebody
       signed terms with them. */
    const access = await trainingAccessFor(
      stub({ ...active, agreement_signed_at: null }), { orgId: ORG, partnerId: PARTNER });
    assert.strictEqual(access.allowed, false);
    assert.strictEqual(access.reason, "agreement_unsigned");
    assert.strictEqual(access.agreementSignedAt, null);
  });

  test("the org is bound on the query, from the caller, every time", async () => {
    const seen = [];
    await trainingAccessFor(stub(active, seen), { orgId: ORG, partnerId: PARTNER });
    assert.equal(seen.length, 1);
    assert.match(seen[0].sql, /org_id\s*=\s*\$2/);
    assert.deepEqual(seen[0].params, [PARTNER, ORG]);
  });

  test("an unscoped call throws rather than answering", async () => {
    // A missing org is a broken session, not a partner with no company. Failing
    // closed here is what stops one company's partner resolving under another's.
    await assert.rejects(
      () => trainingAccessFor(stub(active), { partnerId: PARTNER }),
      /orgId is required/);
    await assert.rejects(
      () => trainingAccessFor(stub(active), { orgId: ORG }),
      /partnerId is required/);
  });

  test("assertTrainingAccess throws a coded error the handler can map to a 403", async () => {
    await assert.rejects(
      () => assertTrainingAccess(stub({ ...active, status: "paused" }), { orgId: ORG, partnerId: PARTNER }),
      (err) => {
        assert.ok(err instanceof TrainingAccessError);
        assert.equal(err.code, "partner_not_active");
        return true;
      });
    // And returns the verdict when it passes, so a caller does not read twice.
    const ok = await assertTrainingAccess(stub(active), { orgId: ORG, partnerId: PARTNER });
    assert.strictEqual(ok.allowed, true);
  });

  test("every refusal has a sentence a non-coder can read", () => {
    for (const reason of ACCESS_REASONS) {
      const msg = accessMessage(reason);
      assert.ok(msg && msg.length > 10, `${reason} has no readable message`);
      // No jargon leaking into a partner-facing string (CLAUDE.md §10).
      assert.ok(!/null|undefined|403|org_id/.test(msg), `${reason}'s message is not plain language`);
    }
    assert.strictEqual(accessMessage("something_else"), "");
  });
});

// Day 8, both answers, against a scripted database.
//
// NO POSTGRES NEEDED, ON PURPOSE. npm test runs with DATABASE_URL unset in most
// environments, and the rules being checked here — a conversion refuses to
// stamp the payout gate without a signature, referrals are VOIDED and never
// deleted, a decline leaves the affiliate row alone — are decisions in code,
// not behaviours of the engine. The engine-level half is checked in
// src/http/trials-live.pg.test.mjs, which skips without a database.

import { test, describe } from "node:test";
import assert from "node:assert";

import { convertTrial, declineTrial, ACCRUAL_BLOCKED_REASON } from "./conversion.mjs";
import { TRIAL_STATUS, VOID_REASON_CONVERTED } from "./constants.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const PARTNER = "22222222-2222-2222-2222-222222222222";
const AFFILIATE = "33333333-3333-3333-3333-333333333333";
const TRIAL = "44444444-4444-4444-4444-444444444444";

function trialRow(over = {}) {
  return {
    id: TRIAL,
    org_id: ORG,
    partner_id: PARTNER,
    affiliate_id: AFFILIATE,
    contact_email: "buyer@example.test",
    status: TRIAL_STATUS.ENDED,
    price_cents: 29700,
    held_start: false,
    started_at: new Date("2026-09-01T00:00:00Z"),
    ends_at: new Date("2026-09-08T00:00:00Z"),
    frozen_until: new Date("2026-10-08T00:00:00Z"),
    converted_at: null,
    declined_at: null,
    ...over
  };
}

/* A scripted database. Every statement it answers is matched on the table it
   touches, and every statement it sees is recorded so the test can assert on
   what was actually run — a gate that answers correctly and writes anyway is
   the failure a return-value-only test cannot see. */
function fakeDb({ trial = trialRow(), referrals = [], voidable = true } = {}) {
  const seen = [];
  return {
    seen,
    query: async (sql, params = []) => {
      seen.push({ sql: sql.replace(/\s+/g, " ").trim(), params });

      if (/FROM live_trials/i.test(sql)) return { rows: trial ? [trial] : [] };
      if (/UPDATE partners/i.test(sql)) {
        return { rows: [{ id: PARTNER, status: /'active'/.test(sql) ? "active" : "paused",
                          agreement_signed_at: params[2] || null, revenue_share_pct: 50 }] };
      }
      if (/FROM affiliate_referrals/i.test(sql)) return { rows: referrals };
      if (/UPDATE affiliate_referrals/i.test(sql)) {
        return { rows: voidable ? [{ id: params[0], status: "void" }] : [] };
      }
      if (/UPDATE live_trials/i.test(sql)) return { rows: [trialRow({ status: params[2] })] };
      if (/INSERT INTO live_trial_events/i.test(sql)) {
        return { rows: [{ id: "evt", kind: params[2], occurred_at: new Date() }] };
      }
      if (/UPDATE partner_pages/i.test(sql)) return { rows: [{ id: "page-1" }] };
      if (/FROM affiliates/i.test(sql)) {
        return { rows: [{ id: AFFILIATE, name: "Buyer", tracking_id: "AFF-000123" }] };
      }
      // queueAffiliateTemplate's template lookup. No template row means the
      // welcome is not queued, and the decline still stands.
      if (/FROM message_templates/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };
}

describe("convertTrial", () => {
  /* THE PAYOUT GATE IS NOT OPENED ON A PROMISE. agreement_signed_at plus
     status='active' is the whole of 042_partners.sql's payout trigger, and
     defaulting the signature to now() would open it for somebody who signed
     nothing. */
  test("refuses without a signed agreement, and writes nothing", async () => {
    const db = fakeDb();
    const out = await convertTrial(db, { orgId: ORG, partnerId: PARTNER });
    assert.equal(out.ok, false);
    assert.equal(out.error, "agreement_not_signed");
    assert.equal(db.seen.length, 0);
  });

  test("flips the partner to active and stamps the signature", async () => {
    const signed = new Date("2026-09-08T17:00:00Z");
    const db = fakeDb();
    const out = await convertTrial(db, { orgId: ORG, partnerId: PARTNER, agreementSignedAt: signed });
    assert.equal(out.ok, true);
    assert.equal(out.partner_status, "active");
    const update = db.seen.find((s) => /UPDATE partners/i.test(s.sql));
    assert.match(update.sql, /status = 'active'/);
    assert.match(update.sql, /agreement_signed_at = COALESCE\(agreement_signed_at, \$3\)/);
    assert.equal(update.params[2], signed);
  });

  test("voids every trial referral with a reason — never a delete", async () => {
    const db = fakeDb({ referrals: [{ id: "r1" }, { id: "r2" }] });
    const out = await convertTrial(db, {
      orgId: ORG, partnerId: PARTNER, agreementSignedAt: new Date()
    });
    assert.equal(out.referrals_voided, 2);
    const voids = db.seen.filter((s) => /UPDATE affiliate_referrals/i.test(s.sql));
    assert.equal(voids.length, 2);
    for (const v of voids) {
      assert.match(v.sql, /SET status = 'void'/);
      assert.equal(v.params[1], VOID_REASON_CONVERTED);
    }
    assert.equal(db.seen.some((s) => /DELETE FROM affiliate_referrals/i.test(s.sql)), false);
  });

  /* voidReferral refuses a row that is already 'paid'. Money that went out does
     not come back (no clawbacks), so an unvoidable referral is REPORTED rather
     than swallowed. */
  test("an already-paid referral is reported, not hidden", async () => {
    const db = fakeDb({ referrals: [{ id: "paid-1" }], voidable: false });
    const out = await convertTrial(db, {
      orgId: ORG, partnerId: PARTNER, agreementSignedAt: new Date()
    });
    assert.equal(out.referrals_voided, 0);
    assert.deepEqual(out.referrals_not_voided, ["paid-1"]);
  });

  test("records the $297 as a cash rebate in cents, not a discount", async () => {
    const db = fakeDb();
    const out = await convertTrial(db, {
      orgId: ORG, partnerId: PARTNER, agreementSignedAt: new Date()
    });
    assert.equal(out.trial_rebate_cents, 29700);
    assert.equal(out.entry_price_cents, 1000000);
    const evt = db.seen.find((s) => /INSERT INTO live_trial_events/i.test(s.sql));
    const detail = JSON.parse(evt.params[3]);
    assert.equal(detail.trial_rebate_cents, 29700);
    assert.equal(detail.entry_price_cents, 1000000);
  });

  /* NOBODY IS PAID BY THIS CALL. Nothing in production writes partner or
     affiliate money yet, and the response has to say so rather than letting a
     screen render "you will be paid" over a rail that does not exist. */
  test("says out loud that nothing is payable yet", async () => {
    const out = await convertTrial(fakeDb(), {
      orgId: ORG, partnerId: PARTNER, agreementSignedAt: new Date()
    });
    assert.equal(out.payable, false);
    assert.equal(out.payable_blocked_reason, ACCRUAL_BLOCKED_REASON);
  });

  test("a second conversion is a no-op, not a second stamp", async () => {
    const db = fakeDb({ trial: trialRow({ status: TRIAL_STATUS.CONVERTED }) });
    const out = await convertTrial(db, {
      orgId: ORG, partnerId: PARTNER, agreementSignedAt: new Date()
    });
    assert.equal(out.already, true);
    assert.equal(db.seen.some((s) => /UPDATE partners/i.test(s.sql)), false);
  });

  test("a declined trial cannot be converted behind its own back", async () => {
    const db = fakeDb({ trial: trialRow({ status: TRIAL_STATUS.DECLINED }) });
    const out = await convertTrial(db, {
      orgId: ORG, partnerId: PARTNER, agreementSignedAt: new Date()
    });
    assert.equal(out.ok, false);
    assert.equal(out.error, "trial_already_declined");
  });

  test("no trial is a 404, not a partner flipped to active anyway", async () => {
    const db = fakeDb({ trial: null });
    const out = await convertTrial(db, {
      orgId: ORG, partnerId: PARTNER, agreementSignedAt: new Date()
    });
    assert.equal(out.status, 404);
    assert.equal(db.seen.some((s) => /UPDATE partners/i.test(s.sql)), false);
  });
});

describe("declineTrial", () => {
  test("pauses the partner and archives the page", async () => {
    const db = fakeDb();
    const out = await declineTrial(db, { orgId: ORG, partnerId: PARTNER });
    assert.equal(out.ok, true);
    assert.equal(out.partner_status, "paused");
    const pages = db.seen.find((s) => /UPDATE partner_pages/i.test(s.sql));
    assert.match(pages.sql, /SET status = 'archived'/);
    assert.equal(out.pages_archived, 1);
  });

  /* THE WHOLE DAY-8 PROMISE. The referrals already point at the buyer's own
     affiliate account, so keeping the leads needs no code — which is exactly
     why the affiliate row was created on day 0. */
  test("touches no referral at all — the leads simply stay", async () => {
    const db = fakeDb({ referrals: [{ id: "r1" }] });
    await declineTrial(db, { orgId: ORG, partnerId: PARTNER });
    assert.equal(db.seen.some((s) => /affiliate_referrals/i.test(s.sql)), false);
  });

  test("keeps the affiliate row and hands back who owns the leads", async () => {
    const out = await declineTrial(fakeDb(), { orgId: ORG, partnerId: PARTNER });
    assert.equal(out.affiliate_id, AFFILIATE);
    assert.match(out.message, /You keep every lead/);
    assert.match(out.message, /20% on the deposits/);
  });

  test("a welcome that cannot queue does not undo the decline", async () => {
    const db = fakeDb();
    const out = await declineTrial(db, { orgId: ORG, partnerId: PARTNER });
    assert.equal(out.ok, true);
    assert.equal(out.affiliate_welcome_queued, false);
  });

  test("hands back how long the frozen dashboard stays readable", async () => {
    const out = await declineTrial(fakeDb(), { orgId: ORG, partnerId: PARTNER });
    assert.equal(out.dashboard_readable_until.toISOString(), "2026-10-08T00:00:00.000Z");
  });

  test("a converted trial cannot be declined", async () => {
    const db = fakeDb({ trial: trialRow({ status: TRIAL_STATUS.CONVERTED }) });
    const out = await declineTrial(db, { orgId: ORG, partnerId: PARTNER });
    assert.equal(out.ok, false);
    assert.equal(out.error, "trial_already_converted");
  });

  test("declining twice is a no-op", async () => {
    const db = fakeDb({ trial: trialRow({ status: TRIAL_STATUS.DECLINED }) });
    const out = await declineTrial(db, { orgId: ORG, partnerId: PARTNER });
    assert.equal(out.already, true);
    assert.equal(db.seen.some((s) => /UPDATE partners/i.test(s.sql)), false);
  });

  test("says out loud that nothing is payable yet", async () => {
    const out = await declineTrial(fakeDb(), { orgId: ORG, partnerId: PARTNER });
    assert.equal(out.payable, false);
    assert.equal(out.payable_blocked_reason, ACCRUAL_BLOCKED_REASON);
  });
});

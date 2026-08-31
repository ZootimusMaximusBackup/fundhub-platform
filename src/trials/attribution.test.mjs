// Lead ownership. The day-8 promise is only true if this is right on day 0.

import { test, describe } from "node:test";
import assert from "node:assert";

import { tagLink, tagPageBody, trialAttributionArgs, listTrialReferrals, CONVERSION_VOID_REASON }
  from "./attribution.mjs";
import { TRIAL_ATTRIBUTION_PARAM, TRIAL_LEAD_SOURCE } from "./constants.mjs";

describe("tagLink", () => {
  /* `a1` IS NOT AN ARBITRARY NAME. parseAffiliateClickBody in
     api/public/affiliate-click.mjs accepts ref, code and a1, and
     af-02-referral-ownership-capture reads a1 and a2 off the event payload.
     Using it means zero new attribution code. */
  test("uses a1, which is the parameter the capture workflow already reads", () => {
    assert.equal(TRIAL_ATTRIBUTION_PARAM, "a1");
    assert.equal(tagLink("https://apply.fundhub.ai/", "AFF-000123"),
      "https://apply.fundhub.ai/?a1=AFF-000123");
  });

  test("keeps an existing query string", () => {
    const out = tagLink("https://apply.fundhub.ai/?utm=x", "AFF-1");
    assert.match(out, /utm=x/);
    assert.match(out, /a1=AFF-1/);
  });

  test("never writes a second a1", () => {
    const out = tagLink("https://apply.fundhub.ai/?a1=OLD", "NEW");
    assert.equal((out.match(/a1=/g) || []).length, 1);
    assert.match(out, /a1=NEW/);
  });

  test("the tag goes in the query, not after a #hash where no server sees it", () => {
    assert.equal(tagLink("https://x.test/page#apply", "AFF-1"), "https://x.test/page?a1=AFF-1#apply");
  });

  /* AN EMPTY TAG IS WORSE THAN NO TAG, because it looks attributed. */
  test("a blank tracking id leaves the link alone", () => {
    assert.equal(tagLink("https://x.test/", ""), "https://x.test/");
    assert.equal(tagLink("https://x.test/", null), "https://x.test/");
  });

  test("a blank url stays blank", () => {
    assert.equal(tagLink("", "AFF-1"), "");
  });
});

describe("tagPageBody", () => {
  test("tags every link and leaves locked legal sections untouched", () => {
    const body = {
      sections: [
        { id: "cta", type: "cta", href: "https://apply.fundhub.ai/" },
        { id: "legal-fulfilment", type: "legal", locked: true, text: "words" }
      ]
    };
    const out = tagPageBody(body, "AFF-9");
    assert.match(out.sections[0].href, /a1=AFF-9/);
    assert.deepEqual(out.sections[1], body.sections[1]);
  });

  test("a body with no sections survives", () => {
    assert.deepEqual(tagPageBody(null, "AFF-9"), { sections: [] });
  });
});

describe("trialAttributionArgs", () => {
  test("tier is direct and the source marks it as trial-sourced", () => {
    const args = trialAttributionArgs({
      orgId: "o", affiliateId: "a", clientId: "c", trackingId: "AFF-1", liveTrialId: "t"
    });
    assert.equal(args.tier, "direct");
    assert.equal(args.source, TRIAL_LEAD_SOURCE);
    assert.equal(args.trackingIdUsed, "AFF-1");
    assert.deepEqual(args.detail, { live_trial_id: "t" });
  });

  test("refuses to build an unscoped attribution", () => {
    assert.throws(() => trialAttributionArgs({ orgId: "o", clientId: "c" }), /required/);
  });
});

describe("listTrialReferrals", () => {
  test("scopes on org and affiliate, filters to trial-sourced, skips void and paid", async () => {
    let sql = "", params = null;
    const db = { query: async (q, p) => { sql = q; params = p; return { rows: [{ id: "r1" }] }; } };
    const rows = await listTrialReferrals(db, { orgId: "org-1", affiliateId: "aff-1" });
    assert.deepEqual(rows, [{ id: "r1" }]);
    assert.match(sql, /org_id = \$1/);
    assert.match(sql, /affiliate_id = \$2/);
    assert.match(sql, /source = \$3/);
    assert.match(sql, /status NOT IN \('void', 'paid'\)/);
    assert.deepEqual(params, ["org-1", "aff-1", TRIAL_LEAD_SOURCE]);
  });

  test("no affiliate means no rows and no query", async () => {
    let called = false;
    const db = { query: async () => { called = true; return { rows: [] }; } };
    assert.deepEqual(await listTrialReferrals(db, { orgId: "o", affiliateId: null }), []);
    assert.equal(called, false);
  });
});

describe("the void reason", () => {
  test("is 'converted_to_partner' — a reason, never a delete", () => {
    assert.equal(CONVERSION_VOID_REASON, "converted_to_partner");
  });
});

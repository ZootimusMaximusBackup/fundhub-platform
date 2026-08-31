// Day-0 provisioning, against a scripted database connection.
//
// WHAT THIS FILE IS ACTUALLY GUARDING:
//   * the sale the gate held is REFUSED, and nothing is created
//   * the affiliate row is created on DAY 0 — the day-8 promise depends on it
//   * the partner row is 'invited' with agreement_signed_at untouched, so the
//     payout gate in 042 stays shut
//   * the clock is NOT started here
//   * the funnel page is created as a DRAFT; publishing is the human gate's job
//
// The transaction itself (BEGIN/COMMIT/ROLLBACK) is asserted on, because a
// provision that half-succeeds leaves a partner row with no affiliate row —
// which is the one state that silently loses leads.

import { test, describe } from "node:test";
import assert from "node:assert";

import { parseTrialSignup, provisionLiveTrial, publishTrialFunnel, revokeTrialFunnel, slugFromName }
  from "./provision.mjs";
import { TRIAL_STATUS, LIVE_TRIAL_PRICE_CENTS } from "./constants.mjs";
import { DECISION } from "./eligibility.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";

const SIGNUP = {
  name: "Dana Reyes",
  email: "dana@redline.test",
  company: "Redline Capital",
  eligibility: { has_ad_account: true, business_verified: true, can_fund_ad_spend: true }
};

function scriptedClient({ existingPartner = null, existingAccount = null, owner = "staff-1" } = {}) {
  const seen = [];
  return {
    seen,
    released: false,
    release() { this.released = true; },
    query: async (sql, params = []) => {
      seen.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      const s = String(sql);
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return { rows: [] };
      if (/FROM partners/i.test(s) && /contact_email/i.test(s)) {
        return { rows: existingPartner ? [existingPartner] : [] };
      }
      if (/SELECT 1 FROM partners/i.test(s)) return { rows: [] };
      if (/INSERT INTO partners/i.test(s)) {
        return { rows: [{ id: "partner-1", slug: params[3], status: "invited" }] };
      }
      if (/FROM accounts/i.test(s)) return { rows: existingAccount ? [existingAccount] : [] };
      if (/FROM affiliates/i.test(s)) return { rows: [] };
      if (/INSERT INTO affiliates/i.test(s)) {
        return { rows: [{ id: "aff-1", tracking_id: "AFF-000123" }] };
      }
      if (/FROM staff/i.test(s)) return { rows: owner ? [{ id: owner }] : [] };
      if (/INSERT INTO partner_brand/i.test(s)) return { rows: [] };
      if (/INSERT INTO partner_pages/i.test(s)) return { rows: [{ id: "page-1" }] };
      if (/INSERT INTO live_trials/i.test(s)) {
        return { rows: [{ id: "trial-1", status: params[4], price_cents: params[5] }] };
      }
      if (/INSERT INTO live_trial_events/i.test(s)) {
        return { rows: [{ id: "evt-1", kind: params[2], occurred_at: new Date() }] };
      }
      return { rows: [] };
    }
  };
}

function deps(client, over = {}) {
  return {
    db: { query: async () => ({ rows: [] }) },
    connect: async () => client,
    createAccount: async () => ({ id: "acct-1" }),
    resolveDefaultOrg: async () => ORG,
    password: "test-password",
    ...over
  };
}

describe("parseTrialSignup", () => {
  test("name and a real email are required", () => {
    assert.equal(parseTrialSignup({ email: "x@y.test" }).error, "name_email_required");
    assert.equal(parseTrialSignup({ name: "A", email: "not-an-email" }).error, "name_email_required");
  });

  test("carries the gate's decision, so provisioning cannot skip it", () => {
    const p = parseTrialSignup(SIGNUP);
    assert.equal(p.ok, true);
    assert.equal(p.decision.decision, DECISION.SELL);
  });

  test("an unanswered gate parses, and its decision holds the sale", () => {
    const p = parseTrialSignup({ name: "A", email: "a@b.test" });
    assert.equal(p.ok, true);
    assert.equal(p.decision.decision, DECISION.HOLD_SALE);
  });

  test("the entity name falls back to the company, then the person", () => {
    assert.equal(parseTrialSignup(SIGNUP).entityName, "Redline Capital");
    assert.equal(parseTrialSignup({ name: "Solo Op", email: "s@o.test" }).entityName, "Solo Op");
  });
});

describe("provisionLiveTrial", () => {
  /* THERE IS NO "PROVISION IT ANYWAY" PATH. Selling seven days FundHub cannot
     deliver is the failure the whole gate exists to prevent. */
  test("refuses a sale the gate held, and creates nothing", async () => {
    const client = scriptedClient();
    const out = await provisionLiveTrial(
      { ...SIGNUP, eligibility: { has_ad_account: false, business_verified: true, can_fund_ad_spend: true } },
      deps(client)
    );
    assert.equal(out.ok, false);
    assert.equal(out.status, 409);
    assert.equal(out.error, "not_eligible");
    assert.equal(client.seen.length, 0);
  });

  test("creates the partner as 'invited' with the share at 50 and no signature", async () => {
    const client = scriptedClient();
    await provisionLiveTrial(SIGNUP, deps(client));
    const ins = client.seen.find((q) => /INSERT INTO partners/i.test(q.sql));
    assert.match(ins.sql, /'invited'/);
    assert.match(ins.sql, /revenue_share_pct/);
    assert.match(ins.sql, /,50,/);
    // agreement_signed_at is never in the insert. 042's payout gate stays shut.
    assert.ok(!/agreement_signed_at/i.test(ins.sql));
  });

  /* THE AFFILIATE ROW IS CREATED ON DAY 0. attribute() is first-writer-wins
     with no undo, so an affiliate that appears on day 8 loses every lead
     another path already claimed. */
  test("creates the affiliate row during provisioning", async () => {
    const client = scriptedClient();
    const out = await provisionLiveTrial(SIGNUP, deps(client));
    assert.ok(client.seen.some((q) => /INSERT INTO affiliates/i.test(q.sql)));
    assert.equal(out.affiliate_id, "aff-1");
    assert.equal(out.tracking_id, "AFF-000123");
  });

  test("stamps the tracking id onto the funnel links", async () => {
    const client = scriptedClient();
    await provisionLiveTrial(SIGNUP, deps(client));
    const page = client.seen.find((q) => /INSERT INTO partner_pages/i.test(q.sql));
    const body = JSON.parse(page.params[5]);
    const cta = body.sections.find((s) => s.href);
    assert.match(cta.href, /a1=AFF-000123/);
  });

  test("the page is a DRAFT — publishing is the human gate's job", async () => {
    const client = scriptedClient();
    const out = await provisionLiveTrial(SIGNUP, deps(client));
    const page = client.seen.find((q) => /INSERT INTO partner_pages/i.test(q.sql));
    assert.match(page.sql, /'draft'/);
    assert.ok(!/published_at/i.test(page.sql));
    assert.equal(out.site_path, null);
  });

  test("the published page body carries the locked fulfilment disclosure", async () => {
    const client = scriptedClient();
    await provisionLiveTrial(SIGNUP, deps(client));
    const page = client.seen.find((q) => /INSERT INTO partner_pages/i.test(q.sql));
    const body = JSON.parse(page.params[5]);
    const block = body.sections.find((s) => s.id === "legal-fulfilment");
    assert.ok(block, "the trial page would publish without the day-1 disclosure");
    assert.equal(block.locked, true);
    assert.match(block.text, /provided and performed by FundHub/);
  });

  test("the clock is not started, and the response says so", async () => {
    const client = scriptedClient();
    const out = await provisionLiveTrial(SIGNUP, deps(client));
    assert.equal(out.clock_started, false);
    assert.equal(out.trial_status, TRIAL_STATUS.PROVISIONED);
    const trial = client.seen.find((q) => /INSERT INTO live_trials/i.test(q.sql));
    // The column list the insert writes — everything before RETURNING — must
    // not mention the clock. NULL means "the ads have not served yet".
    const written = trial.sql.split(/RETURNING/i)[0];
    assert.ok(!/started_at/i.test(written));
    assert.ok(!/ends_at/i.test(written));
  });

  test("an unverified business is provisioned as a held start", async () => {
    const client = scriptedClient();
    const out = await provisionLiveTrial(
      { ...SIGNUP, eligibility: { has_ad_account: true, business_verified: false, can_fund_ad_spend: true } },
      deps(client)
    );
    assert.equal(out.ok, true);
    assert.equal(out.held_start, true);
    assert.equal(out.trial_status, TRIAL_STATUS.HELD_START);
  });

  test("charges $297 in integer cents", async () => {
    const client = scriptedClient();
    await provisionLiveTrial(SIGNUP, deps(client));
    const trial = client.seen.find((q) => /INSERT INTO live_trials/i.test(q.sql));
    assert.equal(trial.params[5], LIVE_TRIAL_PRICE_CENTS);
  });

  test("commits, and releases the connection", async () => {
    const client = scriptedClient();
    await provisionLiveTrial(SIGNUP, deps(client));
    assert.equal(client.seen[0].sql, "BEGIN");
    assert.ok(client.seen.some((q) => q.sql === "COMMIT"));
    assert.equal(client.released, true);
  });

  test("rolls back and releases when a statement fails", async () => {
    const client = scriptedClient();
    const boom = new Error("no");
    const original = client.query.bind(client);
    client.query = async (sql, params) => {
      if (/INSERT INTO affiliates/i.test(String(sql))) throw boom;
      return original(sql, params);
    };
    await assert.rejects(() => provisionLiveTrial(SIGNUP, deps(client)), /no/);
    assert.equal(client.released, true);
  });

  /* One login per address per org. A buyer who already has a login keeps it and
     is told so, rather than the whole provision failing on a unique index. */
  test("an existing account is not given a second login", async () => {
    const client = scriptedClient({
      existingAccount: { id: "acct-9", kind: "client", affiliate_id: null, partner_id: null }
    });
    let created = false;
    const out = await provisionLiveTrial(SIGNUP, deps(client, {
      createAccount: async () => { created = true; return { id: "x" }; }
    }));
    assert.equal(created, false);
    assert.equal(out.password, null);
    assert.equal(out.login_blocked, "email_already_has_an_account");
  });

  test("no owner to issue the invite is a 503, not a partner with no login", async () => {
    const client = scriptedClient({ owner: null });
    const out = await provisionLiveTrial(SIGNUP, deps(client));
    assert.equal(out.ok, false);
    assert.equal(out.status, 503);
    assert.ok(client.seen.some((q) => q.sql === "ROLLBACK"));
  });
});

describe("publishTrialFunnel", () => {
  const db = (rows) => ({ query: async (sql, params) => {
    if (/FROM partner_brand/i.test(sql)) return { rows: rows.brand ? [rows.brand] : [] };
    if (/FROM partner_pages/i.test(sql)) return { rows: rows.page ? [rows.page] : [] };
    if (/UPDATE partner_pages/i.test(sql)) return { rows: [{ id: params[0], status: "published" }] };
    return { rows: [] };
  } });

  const goodBody = {
    sections: [{ id: "legal-fulfilment", type: "legal", locked: true, text: "Funding and credit services offered here are provided and performed by FundHub." }]
  };

  test("refuses while the brand is not approved — the human gate is not optional", async () => {
    const out = await publishTrialFunnel(db({ brand: { approval_status: "draft" }, page: { id: "p", body_json: goodBody } }),
      { orgId: ORG, partnerId: "partner-1" });
    assert.deepEqual(out, { published: false, reason: "brand_not_approved" });
  });

  test("refuses a page whose disclosure has gone missing", async () => {
    const out = await publishTrialFunnel(
      db({ brand: { approval_status: "approved", entity_name: "Redline" },
           page: { id: "p", body_json: { sections: [{ id: "hero" }] } } }),
      { orgId: ORG, partnerId: "partner-1" });
    assert.deepEqual(out, { published: false, reason: "disclosure_missing" });
  });

  test("publishes when the brand is approved and the disclosure is present", async () => {
    const out = await publishTrialFunnel(
      db({ brand: { approval_status: "approved", entity_name: "Redline" },
           page: { id: "p", body_json: goodBody } }),
      { orgId: ORG, partnerId: "partner-1" });
    assert.equal(out.published, true);
    assert.equal(out.sitePath, "/sites/partner-1/apply");
  });

  test("no brand row, no publish", async () => {
    const out = await publishTrialFunnel(db({}), { orgId: ORG, partnerId: "partner-1" });
    assert.deepEqual(out, { published: false, reason: "no_brand_row" });
  });
});

describe("revokeTrialFunnel", () => {
  test("archives rather than deletes — the record of what ran must survive", async () => {
    let sql = "";
    const database = { query: async (q, p) => { sql = q; return { rows: [{ id: "p1" }] }; } };
    const out = await revokeTrialFunnel(database, { orgId: ORG, partnerId: "partner-1" });
    assert.equal(out.revoked, 1);
    assert.match(sql, /SET status = 'archived'/);
    assert.ok(!/DELETE/i.test(sql));
  });
});

describe("slugFromName", () => {
  test("url-safe, and never empty", () => {
    assert.equal(slugFromName("Redline Capital!"), "redline-capital");
    assert.equal(slugFromName(""), "trial");
    assert.equal(slugFromName("---"), "trial");
  });
});

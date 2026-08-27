// /api/public/partner-apply — website form validation (no live Postgres).

import { test } from "node:test";
import assert from "node:assert/strict";
import handler, {
  parsePartnerApplyBody,
  slugFromName,
  generateFirstPassword,
  runPartnerApply,
  placeWhiteLabelRailCard
} from "../../api/public/partner-apply.mjs";

function mockRes() {
  const out = { statusCode: 200, headers: {}, body: null };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(code) { out.statusCode = code; return this; },
    json(body) { out.body = body; return this; }
  };
}

test("parsePartnerApplyBody requires name, email, track, audience; phone and SMS are optional", () => {
  assert.equal(parsePartnerApplyBody({}).ok, false);
  assert.equal(parsePartnerApplyBody({
    name: "Sam Rivera", email: "bad", phone: "555", track: "affiliate",
    audience: "list", sms_consent: true
  }).error, "name_email_required");
  assert.equal(parsePartnerApplyBody({
    name: "Sam Rivera", email: "sam@example.com", phone: "5551234567", track: "nope",
    audience: "list", sms_consent: true
  }).error, "track_required");
  const noSms = parsePartnerApplyBody({
    name: "Sam Rivera", email: "sam@example.com", phone: "5551234567", track: "affiliate",
    audience: "list", sms_consent: false
  });
  assert.equal(noSms.ok, true);
  assert.equal(noSms.sms_consent, false);
  const noPhone = parsePartnerApplyBody({
    name: "Sam Rivera", email: "sam@example.com", track: "affiliate",
    audience: "list", sms_consent: false
  });
  assert.equal(noPhone.ok, true);
  assert.equal(noPhone.phone, "");

  const ok = parsePartnerApplyBody({
    full_name: "Sam Rivera",
    email: "Sam@Example.COM",
    phone: "1 (555) 123-4567",
    company: "Rivera LLC",
    track: "white_label",
    audience: "book of clients",
    sms_consent: true
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.email, "sam@example.com");
  assert.equal(ok.phone, "5551234567");
  assert.equal(ok.kind, "partner");
});

test("slugFromName is a URL key", () => {
  assert.equal(slugFromName("Rivera Funding Co."), "rivera-funding-co");
  assert.equal(slugFromName("!!!"), "partner");
});

test("generateFirstPassword meets the 12-character floor", () => {
  const p = generateFirstPassword();
  assert.ok(p.length >= 12);
});

test("POST without a body is 400", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: {} }, res);
  assert.equal(res.out.statusCode, 400);
});

test("GET is 405", async () => {
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.out.statusCode, 405);
});

test("runPartnerApply refuses a duplicate email without creating a row", async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/^BEGIN/i.test(sql) || /^ROLLBACK/i.test(sql) || /^COMMIT/i.test(sql)) {
        return { rows: [] };
      }
      if (/FROM accounts/i.test(sql)) return { rows: [{ id: "acct-1" }] };
      throw new Error("unexpected sql: " + sql);
    },
    release() {}
  };
  const result = await runPartnerApply(
    {
      name: "Sam Rivera",
      email: "sam@example.com",
      phone: "5551234567",
      company: "",
      audience: "list",
      kind: "affiliate",
      sms_consent: true
    },
    {
      db: { query: async () => ({ rows: [] }) },
      resolveDefaultOrg: async () => "org-1",
      connect: async () => client,
      createAccount: async () => { throw new Error("must not create"); }
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "already_registered");
  assert.ok(calls.some((c) => /^ROLLBACK/i.test(c.sql)));
});

test("affiliate apply queues catalog AF1 for that one login", async () => {
  const queued = [];
  const client = {
    query: async (sql) => {
      if (/^BEGIN/i.test(sql) || /^COMMIT/i.test(sql)) return { rows: [] };
      if (/FROM accounts/i.test(sql)) return { rows: [] };
      if (/INSERT INTO affiliates/i.test(sql)) {
        return { rows: [{ id: "aff-1", tracking_id: "AFF-000099" }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const result = await runPartnerApply(
    {
      name: "Sam Rivera",
      email: "e2e+aff-click26@fundhub.ai",
      phone: "5551234567",
      company: "",
      audience: "list",
      kind: "affiliate",
      sms_consent: true
    },
    {
      db: { query: async () => ({ rows: [] }) },
      resolveDefaultOrg: async () => "org-1",
      connect: async () => client,
      createAccount: async () => ({ id: "acct-1" }),
      queueAffiliateTemplate: async (_db, args) => {
        queued.push(args);
        return { queued: true, messageId: "msg-1" };
      }
    }
  );
  assert.equal(result.ok, true);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].email, "e2e+aff-click26@fundhub.ai");
  assert.equal(queued[0].trackingId, "AFF-000099");
  assert.equal(queued[0].eventId, "aff-1");
});

test("placeWhiteLabelRailCard inserts on affiliates_white_label when the rail exists", async () => {
  const calls = [];
  const qx = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/affiliates_white_label/i.test(sql)) {
        return { rows: [{ stage_id: "st-active", pipeline_id: "pipe-r08" }] };
      }
      if (/SELECT id FROM cards WHERE partner_id/i.test(sql)) return { rows: [] };
      if (/INSERT INTO cards/i.test(sql)) return { rows: [{ id: "card-1" }] };
      throw new Error("unexpected sql: " + sql);
    }
  };
  const out = await placeWhiteLabelRailCard(qx, {
    orgId: "org-1",
    partnerId: "part-1",
    stageKey: "active"
  });
  assert.equal(out.placed, true);
  assert.equal(out.created, true);
  assert.ok(calls.some((c) => /INSERT INTO cards/i.test(c.sql)));
  assert.deepEqual(calls.find((c) => /INSERT INTO cards/i.test(c.sql)).params, [
    "org-1", "part-1", "pipe-r08", "st-active"
  ]);
});

test("white-label apply places a named card on R-08", async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/^BEGIN/i.test(sql) || /^COMMIT/i.test(sql)) return { rows: [] };
      if (/FROM accounts/i.test(sql)) return { rows: [] };
      if (/FROM staff/i.test(sql)) return { rows: [{ id: "staff-1" }] };
      if (/SELECT 1 FROM partners/i.test(sql)) return { rows: [] };
      if (/INSERT INTO partners/i.test(sql)) return { rows: [{ id: "part-1", slug: "rivera-llc" }] };
      if (/INSERT INTO partner_brand/i.test(sql)) return { rows: [] };
      if (/INSERT INTO partner_pages/i.test(sql)) return { rows: [] };
      if (/affiliates_white_label/i.test(sql)) {
        return { rows: [{ stage_id: "st-active", pipeline_id: "pipe-r08" }] };
      }
      if (/SELECT id FROM cards WHERE partner_id/i.test(sql)) return { rows: [] };
      if (/INSERT INTO cards/i.test(sql)) return { rows: [{ id: "card-1" }] };
      return { rows: [] };
    },
    release() {}
  };
  const result = await runPartnerApply(
    {
      name: "Sam Rivera",
      email: "e2e+wl-r08@fundhub.ai",
      phone: "5551234567",
      company: "Rivera LLC",
      audience: "book",
      kind: "partner",
      sms_consent: false
    },
    {
      db: { query: async () => ({ rows: [] }) },
      resolveDefaultOrg: async () => "org-1",
      connect: async () => client,
      createAccount: async () => ({ id: "acct-1" })
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.partner_id, "part-1");
  const cardInsert = calls.find((c) => /INSERT INTO cards/i.test(c.sql));
  assert.ok(cardInsert, "white-label apply must insert a pipeline card");
  assert.equal(cardInsert.params[1], "part-1");
});

// /api/public/partner-apply — website form validation (no live Postgres).

import { test } from "node:test";
import assert from "node:assert/strict";
import handler, {
  parsePartnerApplyBody,
  slugFromName,
  generateFirstPassword,
  runPartnerApply
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

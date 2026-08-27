import test from "node:test";
import assert from "node:assert/strict";

import { partnerWelcomeContext, queuePartnerWelcome } from "./welcome.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const PARTNER = "22222222-2222-2222-2222-222222222222";

function fakeDb({ email = true, sms = true } = {}) {
  const inserts = [];
  return {
    inserts,
    async query(sql, params) {
      if (sql.includes("FROM message_templates")) {
        const key = params[1];
        if (key === "EMAIL-PARTNER-WELCOME" && !email) return { rows: [] };
        if (key === "SMS-PARTNER-WELCOME" && !sms) return { rows: [] };
        return {
          rows: [{
            template_key: key,
            subject: key.startsWith("EMAIL") ? "You are in — {{partner.brand}}" : null,
            body: "Hi {{partner.first_name}} — {{partner.login_url}}",
            compliance_passed: true
          }]
        };
      }
      if (sql.includes("INSERT INTO messages")) {
        inserts.push({ sql, params });
        return { rows: [{ id: `msg-${inserts.length}` }] };
      }
      if (sql.includes("messaging_settings")) return { rows: [{ outbound_enabled: false }] };
      return { rows: [] };
    }
  };
}

const base = {
  orgId: ORG,
  partnerId: PARTNER,
  email: "partner@example.com",
  phone: "6616054248",
  name: "Sim Wlabel E2e27",
  brand: "Sim WL Book E2e27",
  kind: "partner",
  loginUrl: "https://fundhub.ai/login.html",
  siteUrl: "https://fundhub.ai/sites/x/apply"
};

test("context uses the first name and the brand", () => {
  const ctx = partnerWelcomeContext({ name: "Sim Wlabel E2e27", brand: "Acme", kind: "partner" });
  assert.equal(ctx.partner.first_name, "Sim");
  assert.equal(ctx.partner.brand, "Acme");
  assert.equal(ctx.partner.kind_label, "white-label");
});

test("welcome email is queued for a new white-label partner", async () => {
  const db = fakeDb();
  const res = await queuePartnerWelcome(db, base);
  assert.equal(res.ok, true);
  assert.equal(res.queued, 1);
  const [emailRow] = db.inserts;
  assert.match(emailRow.sql, /'email'/);
  assert.equal(emailRow.params[5], "partner@example.com");
  assert.equal(emailRow.params[4], `partner:${PARTNER}:welcome:email`);
});

test("text only goes out when the box was ticked, in +1 form", async () => {
  const db = fakeDb();
  const res = await queuePartnerWelcome(db, { ...base, smsConsent: true });
  assert.equal(res.queued, 2);
  const smsRow = db.inserts[1];
  assert.equal(smsRow.params[5], "+16616054248");
});

test("no password ever reaches the copy", async () => {
  const db = fakeDb();
  await queuePartnerWelcome(db, { ...base, password: "hunter2" });
  assert.ok(!db.inserts[0].params[3].includes("hunter2"));
});

test("a missing template is reported, not thrown", async () => {
  const db = fakeDb({ email: false, sms: false });
  const res = await queuePartnerWelcome(db, base);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "nothing_to_send");
});

test("no partner and no email means nothing is sent", async () => {
  const db = fakeDb();
  const res = await queuePartnerWelcome(db, { orgId: ORG });
  assert.equal(res.reason, "missing_ids");
  assert.equal(db.inserts.length, 0);
});

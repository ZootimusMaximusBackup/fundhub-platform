import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  normalizeMailServiceLevel,
  DEFAULT_MAIL_SERVICE_LEVEL,
  toPostgridMailingClass,
  BUREAU_MAIL_ADDRESSES,
  sendLetter,
  verifyMailWebhook,
  parseMailDeliveryEvent,
  createFakeMailLetterProvider
} from "./mail-letter.mjs";

test("normalizeMailServiceLevel defaults to first_class", () => {
  assert.equal(normalizeMailServiceLevel(null), "first_class");
  assert.equal(normalizeMailServiceLevel("nope"), DEFAULT_MAIL_SERVICE_LEVEL);
  assert.equal(normalizeMailServiceLevel("priority"), "priority");
  assert.equal(normalizeMailServiceLevel("PRIORITY_EXPRESS"), "priority_express");
});

test("normalizeMailServiceLevel rejects UPS/FedEx private carriers", () => {
  assert.equal(normalizeMailServiceLevel("ups_express_overnight"), "first_class");
  assert.equal(normalizeMailServiceLevel("fedex_priority_overnight"), "first_class");
  assert.equal(normalizeMailServiceLevel("ups_express_3_day", "priority"), "priority");
});

test("toPostgridMailingClass maps USPS-safe classes only", () => {
  assert.equal(toPostgridMailingClass("first_class"), "usps_first_class");
  assert.equal(toPostgridMailingClass("priority"), "usps_express_3_day");
  assert.equal(toPostgridMailingClass("priority_express"), "express");
  assert.equal(toPostgridMailingClass("fedex"), "usps_first_class");
});

test("bureau P.O. Boxes are hardcoded", () => {
  assert.equal(BUREAU_MAIL_ADDRESSES.EX.address_line1, "P.O. Box 4500");
  assert.equal(BUREAU_MAIL_ADDRESSES.EQ.address_city, "Atlanta");
  assert.equal(BUREAU_MAIL_ADDRESSES.TU.address_zip, "19016");
});

test("sendLetter posts PostGrid body with flat envelope and client return address", async () => {
  let posted = null;
  const sent = await sendLetter({
    env: { POSTGRID_API_KEY: "test-key" },
    serviceLevel: "priority",
    bureau: "EX",
    from: {
      first_name: "Pat",
      last_name: "Client",
      address_line1: "12 Oak St",
      address_city: "Dallas",
      address_state: "TX",
      address_zip: "75201"
    },
    html: "<html>dispute</html>",
    fetchImpl: async (_url, init) => {
      posted = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: { id: "letter_pg_1" } };
        },
        async text() {
          return JSON.stringify({ data: { id: "letter_pg_1" } });
        }
      };
    }
  });
  assert.equal(sent.ok, true);
  assert.equal(sent.providerId, "letter_pg_1");
  assert.equal(posted.mailingClass, "usps_express_3_day");
  assert.equal(posted.envelopeType, "flat");
  assert.equal(posted.from.firstName, "Pat");
  assert.equal(posted.to.addressLine1, "P.O. Box 4500");
  assert.notEqual(String(posted.from.companyName || "").toLowerCase(), "fundhub");
});

test("sendLetter refuses missing return address (never Fundhub default)", async () => {
  const sent = await sendLetter({
    env: { POSTGRID_API_KEY: "test-key" },
    bureau: "EX",
    html: "<html>x</html>"
  });
  assert.equal(sent.ok, false);
  assert.match(sent.error, /return_address/);
});

test("fake provider never transmits", async () => {
  const fake = createFakeMailLetterProvider({ providerId: "ltr_fake" });
  const r = await fake.sendLetter({ serviceLevel: "first_class", from: {}, to: {} });
  assert.equal(r.ok, true);
  assert.equal(r.providerId, "ltr_fake");
  assert.equal(fake.sent.length, 1);
});

test("verifyMailWebhook HMAC + parse delivery.confirmed timestamp", () => {
  const secret = "whsec_pg";
  const raw = JSON.stringify({
    event: "delivery.confirmed",
    job_id: "letter_abc",
    status: "delivered",
    timestamp: "2026-08-07T14:00:00.000Z"
  });
  const sig = createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyMailWebhook(raw, { "postgrid-signature": sig }, { POSTGRID_WEBHOOK_SECRET: secret }), true);
  assert.equal(verifyMailWebhook(raw, { "postgrid-signature": "nope" }, { POSTGRID_WEBHOOK_SECRET: secret }), false);
  assert.equal(verifyMailWebhook(raw, { "postgrid-signature": sig }, {}), false);

  const parsed = parseMailDeliveryEvent(JSON.parse(raw));
  assert.equal(parsed.delivered, true);
  assert.equal(parsed.letterId, "letter_abc");
  assert.equal(parsed.deliveredAt, "2026-08-07T14:00:00.000Z");
});

test("parseMailDeliveryEvent ignores non-delivery events", () => {
  const parsed = parseMailDeliveryEvent({ event: "letter.updated", data: { id: "letter_1", status: "printing" } });
  assert.equal(parsed.delivered, false);
  assert.equal(parsed.deliveredAt, null);
});

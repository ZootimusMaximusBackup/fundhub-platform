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
    // The fence defaults to blocked; a test that expects a letter to go out
    // has to say so. See src/lib/dry-run.mjs.
    env: { POSTGRID_API_KEY: "test-key", MESSAGING_DRY_RUN: "0" },
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

// ── preTransmission: the fact a caller needs before it retries a letter ──────
//
// src/repair/send.mjs decides whether to release its send claim from this. It
// used to decide from the error text, and a fence hold — which says outright
// that nothing was transmitted — was not on the list, so the letter was marked
// mailed, refused for ever, and so was every regenerated replacement.

const ADDRESSED = {
  to: { company_name: "Experian", address_line1: "P.O. Box 4500", address_city: "Allen", address_state: "TX", address_zip: "75013" },
  from: { first_name: "Pat", last_name: "Client", address_line1: "12 Oak St", address_city: "Dallas", address_state: "TX", address_zip: "75201" },
  html: "<html>x</html>"
};

test("every refusal above the network says preTransmission:true", async () => {
  const noKey = await sendLetter({ ...ADDRESSED, env: {} });
  assert.equal(noKey.ok, false);
  assert.equal(noKey.preTransmission, true);

  const noTo = await sendLetter({ ...ADDRESSED, to: null, bureau: null, env: { POSTGRID_API_KEY: "k" } });
  assert.equal(noTo.preTransmission, true);
  assert.equal(noTo.error, "bureau_mail_address_missing");

  const noFrom = await sendLetter({ ...ADDRESSED, from: null, env: { POSTGRID_API_KEY: "k" } });
  assert.equal(noFrom.preTransmission, true);

  const noBody = await sendLetter({ ...ADDRESSED, html: undefined, env: { POSTGRID_API_KEY: "k" } });
  assert.equal(noBody.preTransmission, true);
  assert.equal(noBody.error, "pdf_or_html_required");
});

test("a fence hold says preTransmission:true and never reaches the transport", async () => {
  let calls = 0;
  // MESSAGING_DRY_RUN absent = fence UP. The transport throws if reached.
  const held = await sendLetter({
    ...ADDRESSED,
    env: { POSTGRID_API_KEY: "k" },
    fetchImpl: () => { calls += 1; throw new Error("the fence leaked"); }
  });
  assert.equal(calls, 0, "nothing left the process");
  assert.equal(held.ok, false);
  assert.equal(held.preTransmission, true, "so the letter must stay sendable");
});

test("an HTTP failure says preTransmission:FALSE — the letter may be in the post", async () => {
  const failed = await sendLetter({
    ...ADDRESSED,
    env: { POSTGRID_API_KEY: "k", MESSAGING_DRY_RUN: "0" },
    fetchImpl: async () => new Response("upstream exploded", { status: 502 })
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.preTransmission, false,
    "a 502 went out; retrying it is what puts two envelopes in somebody's post");
});

test("a dropped connection says preTransmission:FALSE", async () => {
  const dropped = await sendLetter({
    ...ADDRESSED,
    env: { POSTGRID_API_KEY: "k", MESSAGING_DRY_RUN: "0" },
    fetchImpl: async () => { throw new Error("socket hang up"); }
  });
  assert.equal(dropped.ok, false);
  assert.equal(dropped.preTransmission, false, "the call was made; nobody knows what PostGrid did with it");
});

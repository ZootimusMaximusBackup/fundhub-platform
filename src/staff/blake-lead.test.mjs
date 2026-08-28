import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLAKE_FROM_EMAIL,
  BLAKE_GMAIL_QUERY,
  isBlakeMail,
  parseReferredLead,
  formatChrisLeadSms
} from "./blake-lead.mjs";

const BLAKE_FROM = `Blake Evertsen <${BLAKE_FROM_EMAIL}>`;

const CLIENT_MAIL = [
  "Hi Jason! Great talking with you. Quick follow-up on the side —",
  "If your file needs some cleanup before we tackle funding, the team I send",
  "clients to is Chris Stanbridge.",
  "",
  "**CLIENT INFO**",
  "Jason Link",
  "(310) 555-0142",
  "jason.link@example.com",
  "",
  "BOOK YOUR FREE CALL with them now:",
  "Keep me posted and reach me by text anytime: (561) 555-0199",
  "Let's GROW in 2026 and God Bless You!",
  "",
  "Blake Evertsen",
  "Founder & CEO",
  "Evertsen Equity",
  "(561) 555-0199",
  BLAKE_FROM_EMAIL
].join("\n");

const SIGNATURE_ONLY = [
  "Thanks —",
  "Blake Evertsen",
  "Founder & CEO",
  "Evertsen Equity",
  "(561) 555-0199",
  BLAKE_FROM_EMAIL
].join("\n");

test("Blake booking mail yields the referred name and phone, not Blake", () => {
  const lead = parseReferredLead({
    from: BLAKE_FROM,
    subject: "Jason Link - [Credit Repair] Booking Link",
    body: CLIENT_MAIL
  });
  assert.ok(lead);
  assert.equal(lead.name, "Jason Link");
  assert.equal(lead.phone, "+13105550142");
  const sms = formatChrisLeadSms(lead);
  assert.match(sms, /Jason Link/);
  assert.match(sms, /\(310\) 555-0142/);
  assert.doesNotMatch(sms, /Blake Evertsen/);
  assert.doesNotMatch(sms, /Blake Edwardson/);
  assert.doesNotMatch(sms, /credit repair/i);
  assert.doesNotMatch(sms, /repair/i);
});

test("signature-only Blake mail does not invent a lead", () => {
  const lead = parseReferredLead({
    from: BLAKE_FROM,
    subject: "Thanks",
    body: SIGNATURE_ONLY
  });
  assert.equal(lead, null);
});

test("calendar invite is not a lead", () => {
  const lead = parseReferredLead({
    from: BLAKE_FROM,
    subject: "Invitation from an unknown sender: (Repair) Orville Robertson and Blake Evertsen",
    body: CLIENT_MAIL
  });
  assert.equal(lead, null);
});

test("forwarded Blake mail still matches and parses the referred person", () => {
  const forwarded = [
    "---------- Forwarded message ---------",
    `From: Blake Evertsen <${BLAKE_FROM_EMAIL}>`,
    "Subject: Maya Chen - [Credit Repair] Booking Link",
    "",
    "**CLIENT INFO**",
    "Maya Chen",
    "415-555-0177",
    "maya@example.com",
    "",
    "Blake Evertsen",
    "(561) 555-0199"
  ].join("\n");
  assert.equal(
    isBlakeMail({
      from: "Chris Stanbridge <s@gmail.com>",
      subject: "Fwd: Maya Chen - [Credit Repair] Booking Link",
      body: forwarded
    }),
    true
  );
  const lead = parseReferredLead({
    from: "Chris Stanbridge <s@gmail.com>",
    subject: "Fwd: Maya Chen - [Credit Repair] Booking Link",
    body: forwarded
  });
  assert.ok(lead);
  assert.equal(lead.name, "Maya Chen");
  assert.equal(lead.phone, "+14155550177");
  const sms = formatChrisLeadSms(lead);
  assert.doesNotMatch(sms, /Blake/);
  assert.doesNotMatch(sms, /repair/i);
});

test("direct Blake From matches; a stranger From does not", () => {
  assert.equal(isBlakeMail({ from: BLAKE_FROM, subject: "Hi", body: "" }), true);
  assert.equal(isBlakeMail({ from: "Blake Edwardson <info@evertsenequity.com>", subject: "Hi" }), true);
  assert.equal(isBlakeMail({ from: "Jordan Blake <jordan@fundhub.ai>", subject: "Hi", body: "" }), false);
});

test("Gmail query and SMS label never say credit repair", () => {
  assert.doesNotMatch(BLAKE_GMAIL_QUERY, /credit repair|\brepair\b/i);
  assert.match(BLAKE_GMAIL_QUERY, /info@evertsenequity.com/);
});

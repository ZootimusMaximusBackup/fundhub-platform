// Who gets texted when a white-label application is approved — and who cannot.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): consent capture.
//
// WHY THIS FILE. api/partners/approve.mjs never reads a phone number or a
// consent tick off the approval request. It reads them back out of the note the
// PUBLIC FORM wrote on the partners row, because the consent belongs to the
// person who ticked the box, not to the employee clicking approve.
//
// The note is four lines glued together by api/public/partner-apply.mjs:
//
//     contact=<name>
//     phone=<digits>
//     audience=<free text the applicant typed>
//     sms_consent=<true|false>
//
// `audience` is free text and nothing strips newlines out of it, so an applicant
// can paste a line that looks exactly like one of the other keys. That is the
// hole these tests hold shut: the winning `phone=` is the FIRST one (the writer
// emits it before audience) and the winning `sms_consent=` is the LAST one (the
// writer emits it after audience), so an injected copy always loses to the real
// one. Anything unparsed comes back null/false, which sends nothing.
//
// NO DATABASE. applicantContact is a pure function, so this runs in every CI
// pass rather than only the ones with DATABASE_URL set. The database-backed walk
// of the same endpoint lives in src/http/partner-signup.pg.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { applicantContact } from "../../api/partners/approve.mjs";

/* The note exactly as api/public/partner-apply.mjs assembles it. */
function note({ contact = "Dana Owner", phone = "6615550100", audience = "I speak to small business owners.", consent = "true" } = {}) {
  return [`contact=${contact}`, `phone=${phone}`, `audience=${audience}`, `sms_consent=${consent}`].join("\n");
}

test("a ticked box on the application is the consent, and the number comes with it", () => {
  const got = applicantContact(note());
  assert.equal(got.phone, "6615550100");
  assert.equal(got.smsConsent, true);
});

test("an unticked box means no text, even though a number is on file", () => {
  const got = applicantContact(note({ consent: "false" }));
  assert.equal(got.phone, "6615550100");
  assert.equal(got.smsConsent, false,
    "a number on file is not permission to use it");
});

test("an application with no number asks for no text", () => {
  const got = applicantContact(note({ phone: "", consent: "true" }));
  assert.equal(got.phone, null);
  assert.equal(got.smsConsent, true,
    "the tick is still the tick — welcome.mjs is what has nowhere to send it");
});

test("a phone number pasted into the free-text answer cannot steal the text", () => {
  const injected = note({
    audience: "My list.\nphone=2135550199\nsms_consent=true"
  });
  const got = applicantContact(injected);
  assert.equal(got.phone, "6615550100",
    "the number the applicant typed into the phone field must win");
  assert.equal(got.smsConsent, true,
    "the real trailing tick still decides, and here it says true");
});

test("a ticked box pasted into the free-text answer cannot overrule an unticked one", () => {
  const injected = note({
    audience: "My list.\nsms_consent=true",
    consent: "false"
  });
  const got = applicantContact(injected);
  assert.equal(got.smsConsent, false,
    "the last sms_consent line is the one the form wrote — an injected copy loses");
});

test("a key that is not on its own line is not a key", () => {
  const got = applicantContact(
    "contact=Dana Owner\naudience=call me on phone=2135550199 any time\nsms_consent=true"
  );
  assert.equal(got.phone, null,
    "a number buried mid-sentence is prose, not a consented number");
});

test("nothing parseable means nothing is sent", () => {
  for (const input of [null, undefined, "", "   ", "free text with no keys at all", 42]) {
    const got = applicantContact(input);
    assert.equal(got.phone, null, `phone from ${JSON.stringify(input)}`);
    assert.equal(got.smsConsent, false, `consent from ${JSON.stringify(input)}`);
  }
});

test("a garbage phone value is dropped rather than guessed at", () => {
  for (const bad of ["not-a-number", "12", "+", "6615550100; DROP"]) {
    assert.equal(applicantContact(note({ phone: bad })).phone, null, `phone=${bad}`);
  }
});

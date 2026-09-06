// The two exit checks that are pure: the escalation screen and the contact
// check. The eight database-backed ones are proved in run.pg.test.mjs against a
// real Postgres, because a mock cannot prove a unique index.

import { test } from "node:test";
import assert from "node:assert";
import {
  looksLikeEscalation, matchedEscalationPattern, contactFor, paymentHoldIsLive,
  ESCALATION_PATTERNS, ESCALATION_PRESCAN, CHASEABLE_STATES, BOUGHT_STATUSES
} from "./exits.mjs";
import { CHECKOUT_LINK_TTL_DAYS } from "../paid-services/link-ttl.mjs";

test("language aimed at us stops the chase", () => {
  for (const said of [
    "I'm getting a lawyer",
    "my attorney will be in touch",
    "I will sue you",
    "this is going to be a lawsuit",
    "starting litigation",
    "I'm taking legal action",
    "see you in small claims",
    "stop harassing me",
    "I'm filing a complaint against Fundhub",
    "this is a scam"
  ]) {
    assert.equal(looksLikeEscalation(said), true, said);
  }
});

test("a client doing exactly what we asked them to do is NOT an escalation", () => {
  // Our own product hands them a CFPB form and a state AG form and tells them
  // to file both. A keyword list that read these as threats would stop every
  // ladder the client has, for following instructions.
  for (const said of [
    "I filed the CFPB one yesterday",
    "should I send the attorney general form too?",
    "the attorney general complaint is ready to go",
    "I want to file a complaint with the CFPB",
    "there is a fraud alert on my file",
    "that account was fraudulent, it wasn't mine"
  ]) {
    assert.equal(looksLikeEscalation(said), false, said);
  }
});

test("an empty or missing message is not an escalation", () => {
  assert.equal(looksLikeEscalation(null), false);
  assert.equal(looksLikeEscalation(undefined), false);
  assert.equal(looksLikeEscalation(""), false);
});

test("no phone means no sms address — the step is skippable, not retryable", () => {
  assert.equal(contactFor({ phone: null }, "sms"), null);
  assert.equal(contactFor({ phone: "" }, "sms"), null);
  assert.equal(contactFor({ phone: "  " }, "sms"), null);
  assert.equal(contactFor({ phone: "555" }, "sms"), null);
  assert.equal(contactFor({ phone: "+15555550123" }, "sms"), "+15555550123");
});

test("a do-not-disturb flag removes the address for that channel only", () => {
  const client = { phone: "+15555550123", email: "a@b.com", dnd_sms: true };
  assert.equal(contactFor(client, "sms"), null);
  assert.equal(contactFor(client, "email"), "a@b.com");
  assert.equal(contactFor({ ...client, dnd_sms: false, dnd_email: true }, "email"), null);
});

test("an address that is not shaped like an address is not an address", () => {
  assert.equal(contactFor({ email: "not-an-email" }, "email"), null);
  assert.equal(contactFor({ email: "a@b" }, "email"), null);
  assert.equal(contactFor({ email: "a@b.com" }, "email"), "a@b.com");
});

test("an unknown channel has no address", () => {
  assert.equal(contactFor({ phone: "+15555550123" }, "voice"), null);
  assert.equal(contactFor({ phone: "+15555550123" }, "carrier pigeon"), null);
});

test("only not_started and in_progress are chased", () => {
  assert.deepEqual([...CHASEABLE_STATES].sort(), ["in_progress", "not_started"]);
  for (const state of ["done", "skipped", "blocked"]) {
    assert.equal(CHASEABLE_STATES.has(state), false, state);
  }
});

test("a quote nobody accepted does not count as having bought the paid alternative", () => {
  assert.equal(BOUGHT_STATUSES.has("quoted"), false);
  assert.equal(BOUGHT_STATUSES.has("awaiting_payment"), false);
  assert.equal(BOUGHT_STATUSES.has("paid"), true);
  assert.equal(BOUGHT_STATUSES.has("fulfilled"), true);
});

test("a REFUND means we did NOT do it, so it is not a purchase", () => {
  /* 'refunded' used to be in this set, so a client whose money had gone back
     was treated for ever as "they paid us to handle this one" and was never
     chased again about a task that is theirs again. */
  assert.equal(BOUGHT_STATUSES.has("refunded"), false);
  assert.equal(BOUGHT_STATUSES.has("cancelled"), false);
  assert.equal(BOUGHT_STATUSES.has("failed"), false);
  assert.deepEqual([...BOUGHT_STATUSES].sort(), ["fulfilled", "paid", "staged"]);
});

/* ── the checkout hold, which used to have no end ─────────────────────────── */

test("a live checkout link holds; an expired one does not", () => {
  const now = new Date("2026-09-10T18:00:00.000Z");
  const days = (n) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

  assert.equal(paymentHoldIsLive({ checkout_expires_at: days(1) }, now), true);
  assert.equal(paymentHoldIsLive({ checkout_expires_at: days(-1) }, now), false,
    "an invitation nobody took is not a reason to stay quiet for ever");
  assert.equal(paymentHoldIsLive({ checkout_expires_at: now.toISOString() }, now), false,
    "the deadline itself is the end of it, not the start of another day");
});

test("no stamp falls back to the request's own age, never to silence for ever", () => {
  /* db/migrations/370 makes a stampless awaiting_payment row unwritable, so
     this branch guards a state that should not arise. If it ever does, the
     answer is the EARLIEST the link could have died — a link is minted at or
     after the request — because guessing late is guessing toward permanent
     quiet, which is the whole defect. */
  const now = new Date("2026-09-10T18:00:00.000Z");
  const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  assert.equal(paymentHoldIsLive({ requested_at: daysAgo(1) }, now), true);
  assert.equal(paymentHoldIsLive({ requested_at: daysAgo(CHECKOUT_LINK_TTL_DAYS + 1) }, now), false);
  assert.equal(paymentHoldIsLive({ requested_at: daysAgo(CHECKOUT_LINK_TTL_DAYS - 1) }, now), true);
});

test("a row with nothing readable on it, and an unreadable clock, both fail closed", () => {
  const now = new Date("2026-09-10T18:00:00.000Z");
  assert.equal(paymentHoldIsLive({}, now), true,
    "unknown is not a licence to send a message");
  assert.equal(paymentHoldIsLive({ checkout_expires_at: "not a date" }, now), true);
  assert.equal(paymentHoldIsLive({ checkout_expires_at: "2026-01-01T00:00:00.000Z" }, new Date("nope")), true);
});

/* ── the SQL pre-filter, pinned in the only direction that matters ────────── */

test("escalation-prefilter: the SQL pattern matches everything the JS patterns do", () => {
  /* db/migrations/368 lets the escalation scan advance a read watermark past
     rows the pre-filter did not return. That is safe ONLY while the pre-filter
     is a superset of the JavaScript rules — a row it skips has to be a row no
     rule could have matched. This test is what keeps that true.

     Every phrase below is one this repo's own rules treat as aimed at us. */
  const prescan = new RegExp(ESCALATION_PRESCAN, "i");
  for (const said of [
    "I'm getting a lawyer",
    "my attorney will be in touch",
    "I will sue you",
    "they are suing us already",
    "he sued the last company",
    "this is going to be a lawsuit",
    "law suit incoming",
    "starting litigation",
    "I'm taking legal action",
    "see you in small claims",
    "I will take you to court",
    "I will take fundhub to court",
    "stop harassing me",
    "this is harassment",
    "you harassed me",
    "I'm filing a complaint against Fundhub",
    "this is a scam"
  ]) {
    assert.equal(looksLikeEscalation(said), true, `the JS rules should match: ${said}`);
    assert.equal(prescan.test(said), true,
      `the SQL pre-filter must not be narrower than the JS rules: ${said}`);
  }
});

test("escalation-prefilter: it is derived from the pattern list, not typed out", () => {
  /* Two hand-kept copies of a keyword list is the drift that produces a message
     nobody intended. Each pattern's own source, minus the two pieces of syntax
     that can only ever NARROW a match, has to appear in the pre-filter. */
  for (const re of ESCALATION_PATTERNS) {
    const widened = re.source.replace(/\\b/g, "").replace(/\(\?[!=][^)]*\)/g, "");
    assert.ok(ESCALATION_PRESCAN.includes(widened),
      `${re.source} is not represented in the pre-filter`);
  }
});

test("matchedEscalationPattern names OUR rule, never the client's sentence", () => {
  const said = "my attorney will be in touch";
  const hit = matchedEscalationPattern(said);
  assert.ok(hit, "a match should name a pattern");
  assert.equal(hit, ESCALATION_PATTERNS.find((r) => r.test(said)).source);
  assert.equal(hit.includes(said), false, "the stored value must not be the client's words");
  assert.equal(matchedEscalationPattern("all good thanks"), null);
  assert.equal(matchedEscalationPattern(null), null);
});

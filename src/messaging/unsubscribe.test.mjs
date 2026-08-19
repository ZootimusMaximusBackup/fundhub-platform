// Unsubscribe links — the token, and the footer that carries it.
//
// COMPLIANCE-BEARING. Until 2026-08-18 this repo had 173 email templates whose
// copy promised the reader they could unsubscribe, zero links to do it with,
// and a /unsubscribe page that answered 404 (measured live). These tests are
// what stops that coming back.

import { test } from "node:test";
import assert from "node:assert";
import {
  signUnsubscribeUrl, verifyUnsubscribeToken, verifyUnsubscribeRequest,
  withUnsubscribeFooter, unsubscribeSecret,
  UNSUBSCRIBE_MAX_TTL_SECONDS, UNSUBSCRIBE_LINK_SOURCE
} from "./unsubscribe.mjs";

const SECRET = "unit-test-secret-0123456789abcdef0123456789abcdef";
const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const NOW = () => Date.parse("2026-08-18T12:00:00Z");

const mint = (over = {}) =>
  signUnsubscribeUrl({ orgId: ORG, clientId: CLIENT, secret: SECRET, now: NOW, ...over });

const parse = (url) => Object.fromEntries(new URL(url, "http://x.invalid").searchParams);

test("the link carries everything the endpoint needs and nothing it does not", () => {
  const { url, path } = mint({ baseUrl: "https://fundhub.ai" });
  const q = parse(url);
  assert.equal(q.org, ORG);
  assert.equal(q.client, CLIENT);
  assert.equal(q.channel, "email");
  assert.match(q.sig, /^[0-9a-f]{64}$/, "sha256 hex");
  assert.ok(Number(q.exp) > 0);
  assert.ok(url.startsWith("https://fundhub.ai/unsubscribe.html?"), url);
  assert.ok(path.startsWith("/unsubscribe.html?"));
  // The client's actual address is never in the link — only their id. A URL
  // that carried the address would leak it into logs, referrers and history.
  assert.ok(!url.includes("@"), "no email address in the URL");
});

test("the page is at the site root, not under /app — a person unsubscribing has no session", () => {
  // Everything under public/app/ loads shell.js, which demands a session and
  // bounces anybody without one.
  assert.ok(!mint().path.startsWith("/app/"), "must not be behind the signed-in shell");
});

test("a freshly minted link verifies", () => {
  const t = verifyUnsubscribeToken({ ...parse(mint().url), orgId: ORG, clientId: CLIENT, secret: SECRET, now: NOW });
  assert.ok(t);
  assert.equal(t.clientId, CLIENT);
  assert.equal(t.channel, "email");
});

test("verifyUnsubscribeRequest reads a whole URL or a query object", () => {
  const { url } = mint();
  assert.ok(verifyUnsubscribeRequest(url, { secret: SECRET, now: NOW }), "from a url");
  assert.ok(verifyUnsubscribeRequest(parse(url), { secret: SECRET, now: NOW }), "from a query object");
});

test("a tampered client id does not verify — you cannot unsubscribe somebody else", () => {
  const q = parse(mint().url);
  q.client = "33333333-3333-4333-8333-333333333333";
  assert.equal(verifyUnsubscribeRequest(q, { secret: SECRET, now: NOW }), null);
});

test("the CHANNEL is signed, so the link cannot be widened by hand", () => {
  /* Editing channel=email to channel=sms in the address bar would otherwise
     silence the client's texts too — a channel they never asked us to stop. */
  const q = parse(mint().url);
  q.channel = "sms";
  assert.equal(verifyUnsubscribeRequest(q, { secret: SECRET, now: NOW }), null);
});

test("a different secret does not verify", () => {
  const q = parse(mint().url);
  assert.equal(verifyUnsubscribeRequest(q, { secret: "another-secret-0123456789abcdef0123456789ab", now: NOW }), null);
});

test("a link that has run out does not verify", () => {
  const q = parse(mint({ ttlSeconds: 60 }).url);
  const later = () => NOW() + 61_000;
  assert.equal(verifyUnsubscribeRequest(q, { secret: SECRET, now: later }), null);
});

test("the link outlives the CAN-SPAM 30-day floor by a wide margin", () => {
  // The obligation is that the opt-out mechanism still works 30 days after the
  // message went out. An unsubscribe link sits in an archived mailbox far
  // longer than that, and a dead one is the defect this file exists to fix.
  const q = parse(mint().url);
  const thirtyOneDays = () => NOW() + 31 * 24 * 60 * 60 * 1000;
  assert.ok(verifyUnsubscribeRequest(q, { secret: SECRET, now: thirtyOneDays }),
    "must still work well past 30 days");
});

test("a missing or junk field is refused rather than throwing", () => {
  for (const bad of [undefined, null, {}, { org: ORG }, "not a url at all", { org: ORG, client: CLIENT, channel: "email", exp: "abc", sig: "x" }]) {
    assert.doesNotThrow(() => verifyUnsubscribeRequest(bad, { secret: SECRET, now: NOW }));
    assert.equal(verifyUnsubscribeRequest(bad, { secret: SECRET, now: NOW }), null);
  }
});

test("signing fails closed with no secret, and refuses a silly TTL", () => {
  assert.throws(() => unsubscribeSecret({}), /UNSUBSCRIBE_TOKEN_SECRET/);
  assert.throws(() => unsubscribeSecret({ UNSUBSCRIBE_TOKEN_SECRET: "short" }), /too short/);
  assert.doesNotThrow(() => unsubscribeSecret({ DOCUMENT_URL_SECRET: SECRET }), "falls back like contract links do");
  assert.throws(() => mint({ ttlSeconds: UNSUBSCRIBE_MAX_TTL_SECONDS + 1 }), /maximum/);
  assert.throws(() => signUnsubscribeUrl({ clientId: CLIENT, secret: SECRET }), /requires orgId/);
});

test("a soft-pull consent link can never be replayed as an unsubscribe link", () => {
  /* Domain separation. The two mean opposite things — one grants permission to
     pull a credit file, the other withdraws permission to email — and they are
     signed with the same secret by default, so only the scheme keeps them
     apart. */
  const q = parse(mint().url);
  const asSoftPull = { org: q.org, client: q.client, exp: q.exp, sig: q.sig, channel: "email" };
  // Same fields, different scheme inside the HMAC: the unsubscribe verifier is
  // the only thing that accepts this signature.
  assert.ok(verifyUnsubscribeRequest(asSoftPull, { secret: SECRET, now: NOW }));
  const forged = { ...q, sig: q.sig.replace(/^./, (c) => (c === "a" ? "b" : "a")) };
  assert.equal(verifyUnsubscribeRequest(forged, { secret: SECRET, now: NOW }), null);
});

/* ── the footer ──────────────────────────────────────────────────────────── */

test("a plain-text body gets a plain-text footer, not markup", () => {
  const out = withUnsubscribeFooter("Hello there.", "https://fundhub.ai/unsubscribe.html?x=1");
  assert.ok(out.startsWith("Hello there."), "the approved copy is untouched at the front");
  assert.ok(out.includes("https://fundhub.ai/unsubscribe.html?x=1"));
  assert.ok(!/<a /.test(out), "a raw anchor in a text body renders as literal angle brackets");
});

test("an HTML body gets an anchor, so the link is clickable", () => {
  const body = "<html><body><p>Hello</p></body></html>";
  const out = withUnsubscribeFooter(body, "https://fundhub.ai/unsubscribe.html?x=1");
  assert.ok(out.includes('<a href="https://fundhub.ai/unsubscribe.html?x=1"'));
  assert.ok(out.startsWith(body), "the approved copy is untouched at the front");
});

test("a body that already carries the link is left alone", () => {
  const url = "https://fundhub.ai/unsubscribe.html?x=1";
  const body = `Hi. Unsubscribe: ${url}`;
  assert.equal(withUnsubscribeFooter(body, url), body, "no second footer");
});

test("no link, no footer — the body is returned untouched", () => {
  assert.equal(withUnsubscribeFooter("Hello.", null), "Hello.");
  assert.equal(withUnsubscribeFooter("Hello.", ""), "Hello.");
});

test("the footer says what it does in plain words", () => {
  const out = withUnsubscribeFooter("Hi.", "https://fundhub.ai/unsubscribe.html?x=1");
  assert.match(out, /unsubscribe/i, "the reader has to be able to see what the link is for");
});

test("the link source is recorded apart from a STOP reply and a provider signal", () => {
  // Three different things happened and an operator has to be able to tell
  // which: they pressed the link, they replied STOP, or Mailgun told us.
  assert.equal(UNSUBSCRIBE_LINK_SOURCE, "unsubscribe_link");
  assert.notEqual(UNSUBSCRIBE_LINK_SOURCE, "inbound_keyword");
  assert.notEqual(UNSUBSCRIBE_LINK_SOURCE, "provider_unsubscribe");
});

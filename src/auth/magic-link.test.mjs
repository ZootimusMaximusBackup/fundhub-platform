// Magic link — the parts that need no database.
//
// Everything that decides WHO gets a link needs real rows and lives in
// magic-link.pg.test.mjs. What is here is the surface a caller can get wrong
// without ever reaching Postgres: the address check, the link URL, and the two
// refusals that must not cost a query.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  requestMagicLink, verifyMagicLink, magicLinkUrl, normalizeEmail,
  LINK_TTL_MINUTES, BOOKING_CONFIRM_LINK_TTL_MINUTES, LINK_LIMITS, MAGIC_LINK_TEMPLATE_KEY
} from "./magic-link.mjs";

/* A db that fails loudly if it is touched. Every test below asserts a refusal
   that must be decided BEFORE any query — a malformed address costing a
   database round trip is how a sign-in form becomes a denial-of-service lever
   against the database everything else shares. */
const noDb = {
  query() { throw new Error("this path must not reach the database"); }
};

describe("magic link — no database needed", () => {
  test("a missing or malformed address is refused without a query", async () => {
    for (const bad of [undefined, null, "", "   ", "nope", "no@host", "a b@c.io", 42, {}]) {
      const out = await requestMagicLink(noDb, { email: bad });
      assert.equal(out.ok, false, `accepted ${JSON.stringify(bad)}`);
      assert.equal(out.status, 400);
      assert.equal(out.error, "email_required");
    }
  });

  test("a missing token is refused without a query", async () => {
    for (const bad of [undefined, null, "", 0, {}, []]) {
      const out = await verifyMagicLink(noDb, bad);
      assert.equal(out.ok, false);
      assert.equal(out.status, 400);
      assert.equal(out.error, "token_required");
    }
  });

  test("addresses are normalised the same way login.mjs normalises them", () => {
    assert.equal(normalizeEmail("  Dana@FundHub.TEST  "), "dana@fundhub.test");
    assert.equal(normalizeEmail(null), "");
    assert.equal(normalizeEmail(7), "");
  });

  describe("the emailed URL", () => {
    test("points at the PAGE, not at the verification endpoint", () => {
      // If this ever points at /api/…, a mail scanner following links in the
      // message spends the single use before the client clicks. See the header
      // of api/auth/magic-link-verify.mjs.
      const url = magicLinkUrl("tok", { PORTAL_BASE_URL: "https://x.test" });
      assert.equal(url, "https://x.test/portal-login.html?t=tok");
      assert.ok(!url.includes("/api/"));
    });

    test("the token is percent-encoded", () => {
      // base64url never produces these, but the URL is assembled by string
      // concatenation and a token format change must not silently produce a
      // second query parameter.
      const url = magicLinkUrl("a+b/c=d&e", { PORTAL_BASE_URL: "https://x.test" });
      assert.ok(url.endsWith("?t=a%2Bb%2Fc%3Dd%26e"), url);
    });

    test("a trailing slash on the base does not double up", () => {
      assert.equal(
        magicLinkUrl("t", { PORTAL_BASE_URL: "https://x.test/" }),
        "https://x.test/portal-login.html?t=t"
      );
    });

    test("falls back through Netlify's own variables before the hardcoded host", () => {
      assert.ok(magicLinkUrl("t", { DEPLOY_PRIME_URL: "https://preview.test" })
        .startsWith("https://preview.test/"));
      assert.ok(magicLinkUrl("t", { URL: "https://prod.test" })
        .startsWith("https://prod.test/"));
      assert.ok(magicLinkUrl("t", {}).startsWith("https://fundhub.ai/"));
      // Ours wins over Netlify's when both are set.
      assert.ok(magicLinkUrl("t", { PORTAL_BASE_URL: "https://ours.test", URL: "https://theirs.test" })
        .startsWith("https://ours.test/"));
    });
  });

  test("the link is short-lived and the template key is the seeded one", () => {
    // Both are load-bearing constants rather than preferences: the TTL is what
    // makes a link left in an inbox stop being a credential, and the key must
    // match db/seed/007_portal_magic_link_template.sql exactly or sendTemplated
    // finds no row and silently queues nothing.
    assert.equal(LINK_TTL_MINUTES, 15);
    assert.equal(BOOKING_CONFIRM_LINK_TTL_MINUTES, 365 * 24 * 60);
    assert.equal(MAGIC_LINK_TEMPLATE_KEY, "EMAIL-PORTAL-MAGIC-LINK");
  });

  test("the request limits are per-email AND per-source", () => {
    assert.ok(LINK_LIMITS.maxPerEmail > 0 && LINK_LIMITS.maxPerEmail <= 5);
    // The IP limit must be the looser of the two, or a household or office
    // behind one address locks out on the second person to sign in.
    assert.ok(LINK_LIMITS.maxPerIp > LINK_LIMITS.maxPerEmail);
    assert.ok(LINK_LIMITS.windowMinutes > 0);
  });
});

// /api/public/optimize — gated Smart Credit + Audit checkout on a keep title.

import { test } from "node:test";
import assert from "node:assert/strict";
import handler, {
  AUDIT_KEEP_TITLE,
  BOOK_URL,
  SMART_CREDIT_AFFILIATE_URL,
  smartCreditFromEnv,
  parseOptimizeCheckoutBody,
  optimizePageConfig,
  runOptimizeCheckout,
  smartCreditLegalFromEnv,
  widgetThemeFromEnv,
  SMART_CREDIT_LEGAL_ENV,
  SMART_CREDIT_CANCEL_ENV
} from "../../api/public/optimize.mjs";

function mockRes() {
  const out = { statusCode: 200, headers: {}, body: null };
  return {
    out,
    setHeader(k, v) {
      out.headers[k] = v;
    },
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(body) {
      out.body = body;
      return this;
    }
  };
}

test("AUDIT_KEEP_TITLE is the keep Assessment title, not Audit or a new catalog name", () => {
  assert.equal(AUDIT_KEEP_TITLE, "Consulting Services Assessment");
  assert.equal(BOOK_URL, "https://apply.fundhub.ai/schedule/phonecall");
});

test("smartCreditFromEnv uses the Welcome-email affiliate URL when the widget keys are missing", () => {
  const dark = smartCreditFromEnv({});
  assert.equal(dark.affiliateUrl, SMART_CREDIT_AFFILIATE_URL);
  assert.equal(dark.pid, "29056");
  assert.equal(dark.clientKey, undefined);
  assert.equal(smartCreditFromEnv({ CONSUMER_DIRECT_CLIENT_KEY: "abc" }).affiliateUrl, SMART_CREDIT_AFFILIATE_URL);
  assert.equal(smartCreditFromEnv({ CONSUMER_DIRECT_PID: "12345" }).pid, "12345");
});

test("smartCreditFromEnv returns Enrollment Widget URLs when both names exist", () => {
  const live = smartCreditFromEnv({
    CONSUMER_DIRECT_CLIENT_KEY: "key-1",
    CONSUMER_DIRECT_PID: "12345"
  });
  assert.equal(live.clientKey, "key-1");
  assert.equal(live.pid, "12345");
  assert.equal(live.affiliateUrl, SMART_CREDIT_AFFILIATE_URL);
  assert.equal(live.productName, "smartcredit");
  assert.equal(live.memberUrl, "https://www.smartcredit.com");
  assert.equal(live.scriptUrl, "https://cdn.consumerdirect.io/cd-widgets/latest/cd-signup.js");
  const stage = smartCreditFromEnv({
    SMART_CREDIT_CLIENT_KEY: "key-2",
    SMART_CREDIT_PID: "99999",
    CONSUMER_DIRECT_ENV: "stage"
  });
  assert.equal(stage.memberUrl, "https://stage-sc.consumerdirect.app");
  assert.match(stage.scriptUrl, /stage-cdn\.consumerdirect\.io/);
});

test("parseOptimizeCheckoutBody needs an email and ignores a client product title", () => {
  assert.equal(parseOptimizeCheckoutBody({}).error, "email_required");
  const ok = parseOptimizeCheckoutBody({
    email: "Ada@Example.COM",
    first_name: "Ada",
    phone: "6616054248",
    productTitle: "Credit repair, done-for-you"
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.email, "ada@example.com");
  assert.equal(ok.phone, "+16616054248");
  assert.equal(ok.productTitle, undefined);
});

test("optimizePageConfig exposes the affiliate URL and reports checkout readiness from env", () => {
  const dark = optimizePageConfig({});
  assert.equal(dark.ok, true);
  assert.equal(dark.smartCredit.affiliateUrl, SMART_CREDIT_AFFILIATE_URL);
  assert.equal(dark.audit.ready, false);
  const ready = optimizePageConfig({ FANBASIS_CHECKOUT_API_KEY: "fb_test" });
  assert.equal(ready.audit.ready, true);
  assert.equal(ready.bookUrl, BOOK_URL);
});

test("runOptimizeCheckout always mints the keep Assessment title", async () => {
  const seen = [];
  const result = await runOptimizeCheckout(
    { email: "ada@example.com" },
    {
      env: { FANBASIS_CHECKOUT_API_KEY: "fb_test" },
      createCheckoutSession: async (opts) => {
        seen.push(opts);
        return { ok: true, paymentLink: "https://pay.fanbasis.test/x" };
      }
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.checkoutUrl, "https://pay.fanbasis.test/x");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].productTitle, "Consulting Services Assessment");
  assert.equal(seen[0].amountCents, 3200);
});

test("GET /api/public/optimize returns the partner affiliate URL and no widget keys", async () => {
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.body.ok, true);
  assert.equal(res.out.body.smartCredit.affiliateUrl, SMART_CREDIT_AFFILIATE_URL);
  assert.equal(res.out.body.smartCredit.clientKey, undefined);
  assert.equal(res.out.body.bookUrl, BOOK_URL);
  assert.equal(res.out.body.roadmap.ready, true);
});

test("GET /api/public/optimize?view=roadmap returns the existing brain plan", async () => {
  const res = mockRes();
  await handler({ method: "GET", query: { view: "roadmap" } }, res);
  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.body.ok, true);
  assert.equal(res.out.body.source, "sample");
  assert.equal(res.out.body.bookUrl, BOOK_URL);
  assert.equal(res.out.body.rounds.length, 6);
  assert.ok(res.out.body.rounds[0].attacks.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE REVIEW REQUIRED — the SmartCredit policy links (ConsumerDirect
// compliance item 9) and the cancellation route (item 12). Neither address was
// ever given to us. They are read from env by NAME, never invented, and the
// page prints the document name as plain text when the name is unset.
// ─────────────────────────────────────────────────────────────────────────────

test("the four SmartCredit policy addresses are null until someone sets them", () => {
  const legal = smartCreditLegalFromEnv({});
  assert.equal(legal.serviceAgreement, null);
  assert.equal(legal.privacyPolicy, null);
  assert.equal(legal.termsOfUse, null);
  assert.equal(legal.consumerRights, null);
  assert.equal(legal.cancelUrl, null);
});

test("the env var NAMES are the contract, and they are stable", () => {
  assert.deepEqual(SMART_CREDIT_LEGAL_ENV, {
    serviceAgreement: "CONSUMER_DIRECT_SERVICE_AGREEMENT_URL",
    privacyPolicy: "CONSUMER_DIRECT_PRIVACY_POLICY_URL",
    termsOfUse: "CONSUMER_DIRECT_TERMS_OF_USE_URL",
    consumerRights: "CONSUMER_DIRECT_CONSUMER_RIGHTS_URL"
  });
  assert.equal(SMART_CREDIT_CANCEL_ENV, "CONSUMER_DIRECT_CANCEL_URL");
});

test("a policy address is taken only when it is https", () => {
  const legal = smartCreditLegalFromEnv({
    CONSUMER_DIRECT_SERVICE_AGREEMENT_URL: "https://example.com/agreement",
    CONSUMER_DIRECT_PRIVACY_POLICY_URL: "http://example.com/privacy",
    CONSUMER_DIRECT_TERMS_OF_USE_URL: "javascript:alert(1)",
    CONSUMER_DIRECT_CONSUMER_RIGHTS_URL: "not a url"
  });
  assert.equal(legal.serviceAgreement, "https://example.com/agreement");
  assert.equal(legal.privacyPolicy, null, "plain http is refused, not downgraded silently");
  assert.equal(legal.termsOfUse, null, "a script address is never printed as a link");
  assert.equal(legal.consumerRights, null);
});

test("the widget look defaults to ConsumerDirect's own, and rejects anything unknown", () => {
  assert.equal(widgetThemeFromEnv({}), "sc");
  assert.equal(widgetThemeFromEnv({ CONSUMER_DIRECT_WIDGET_THEME: "galaxy" }), "galaxy");
  assert.equal(widgetThemeFromEnv({ CONSUMER_DIRECT_WIDGET_THEME: "MATERIAL" }), "material");
  assert.equal(widgetThemeFromEnv({ CONSUMER_DIRECT_WIDGET_THEME: "fundhub-blue" }), "sc");
});

test("the compliance wording travels on BOTH shapes — widget and plain link", () => {
  const dark = smartCreditFromEnv({ CONSUMER_DIRECT_CONSUMER_RIGHTS_URL: "https://example.com/rights" });
  assert.equal(dark.clientKey, undefined, "still the plain-link shape");
  assert.equal(dark.legal.consumerRights, "https://example.com/rights");

  const live = smartCreditFromEnv({
    CONSUMER_DIRECT_CLIENT_KEY: "key-1",
    CONSUMER_DIRECT_PID: "29056",
    CONSUMER_DIRECT_CONSUMER_RIGHTS_URL: "https://example.com/rights"
  });
  assert.equal(live.legal.consumerRights, "https://example.com/rights");
  assert.equal(live.theme, "sc");
});

test("no key means no widget — production runs on the tracking link on purpose", () => {
  const cfg = optimizePageConfig({});
  assert.equal(cfg.smartCredit.clientKey, undefined);
  assert.equal(cfg.smartCredit.affiliateUrl, SMART_CREDIT_AFFILIATE_URL);
  assert.equal(cfg.smartCredit.scriptUrl, undefined, "their file is never loaded without a key");
});

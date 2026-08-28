// /api/public/optimize — gated Smart Credit + Audit checkout on a keep title.

import { test } from "node:test";
import assert from "node:assert/strict";
import handler, {
  AUDIT_KEEP_TITLE,
  BOOK_URL,
  smartCreditFromEnv,
  parseOptimizeCheckoutBody,
  optimizePageConfig,
  runOptimizeCheckout
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

test("smartCreditFromEnv stays dark when client key or PID is missing", () => {
  assert.equal(smartCreditFromEnv({}), null);
  assert.equal(smartCreditFromEnv({ CONSUMER_DIRECT_CLIENT_KEY: "abc" }), null);
  assert.equal(smartCreditFromEnv({ CONSUMER_DIRECT_PID: "12345" }), null);
  assert.equal(smartCreditFromEnv({ SMART_CREDIT_CLIENT_KEY: "abc" }), null);
});

test("smartCreditFromEnv returns Enrollment Widget URLs when both names exist", () => {
  const live = smartCreditFromEnv({
    CONSUMER_DIRECT_CLIENT_KEY: "key-1",
    CONSUMER_DIRECT_PID: "12345"
  });
  assert.equal(live.clientKey, "key-1");
  assert.equal(live.pid, "12345");
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

test("optimizePageConfig hides Smart Credit and reports checkout readiness from env", () => {
  const dark = optimizePageConfig({});
  assert.equal(dark.ok, true);
  assert.equal(dark.smartCredit, null);
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

test("GET /api/public/optimize does not invent Smart Credit keys", async () => {
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.body.ok, true);
  assert.equal(res.out.body.smartCredit, null);
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

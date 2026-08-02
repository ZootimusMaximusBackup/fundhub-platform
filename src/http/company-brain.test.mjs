import test from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/read/company-brain.mjs";
import reviewsHandler from "../../api/company-brain/reviews.mjs";
import { synthesizeAnswer } from "../company-brain/answer.mjs";

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test("synthesizeAnswer extractive fallback when no API key", async () => {
  const out = await synthesizeAnswer({
    query: "objection script",
    chunks: [{
      fileName: "Closer script.docx",
      content: "When they say the rate is high, ask what they compared it to.",
      webViewLink: "https://drive.google.com/file/d/x",
      accessTier: "sales"
    }],
    env: {}
  });
  assert.equal(out.ok, true);
  assert.equal(out.source, "extractive");
  assert.match(out.text, /Closer script/);
  assert.equal(out.citations.length, 1);
});

test("POST /api/read/company-brain uses session role not body role", async () => {
  let seenRole = null;
  const res = mockRes();
  await handler(
    { method: "POST", body: { question: "scripts", role: "owner" } },
    res,
    {
      requireAuth: async () => ({ id: "s1", org_id: "org-1", role: "closer" }),
      retrieveChunks: async (_db, args) => {
        seenRole = args.role;
        return {
          ok: true,
          chunks: [{
            fileName: "SOP.md",
            content: "Do the thing",
            accessTier: "staff",
            webViewLink: null
          }]
        };
      },
      synthesizeAnswer: async ({ chunks }) => ({
        ok: true,
        text: "Do the thing [1]",
        thin: false,
        source: "test",
        citations: [{ n: 1, fileName: chunks[0].fileName }]
      }),
      env: {}
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(seenRole, "closer");
  assert.equal(res.body.ok, true);
  assert.equal(res.body.role, "closer");
  assert.match(res.body.answer.text, /Do the thing/);
});

test("POST /api/read/company-brain rejects empty question", async () => {
  const res = mockRes();
  await handler(
    { method: "POST", body: {} },
    res,
    { requireAuth: async () => ({ id: "s1", org_id: "org-1", role: "owner" }) }
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "question_required");
});

test("reviews GET is owner-only", async () => {
  const denied = mockRes();
  await reviewsHandler(
    { method: "GET" },
    denied,
    { requireAuth: async () => ({ id: "s1", org_id: "org-1", role: "admin" }) }
  );
  assert.equal(denied.statusCode, 403);

  const ok = mockRes();
  await reviewsHandler(
    { method: "GET" },
    ok,
    {
      requireAuth: async () => ({ id: "s1", org_id: "org-1", role: "owner" }),
      listPendingReviews: async () => ({ ok: true, reviews: [{ id: "r1" }] })
    }
  );
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.reviews.length, 1);
});

test("reviews POST approve requires owner", async () => {
  const res = mockRes();
  await reviewsHandler(
    { method: "POST", body: { review_id: "550e8400-e29b-41d4-a716-446655440000", decision: "approve" } },
    res,
    {
      requireAuth: async () => ({ id: "s1", org_id: "org-1", role: "closer" })
    }
  );
  assert.equal(res.statusCode, 403);
});

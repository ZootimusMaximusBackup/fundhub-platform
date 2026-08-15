// COMPLIANCE REVIEW REQUIRED — /api/repair/send human mail gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/repair/send.mjs";

function resCapture() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; }
  };
}

test("DFY/repair send path calls mail helper when mail=true", async () => {
  const mailCalls = [];
  const db = {
    async query(sql) {
      const s = String(sql);
      if (s.includes("FROM clients")) return { rows: [{ id: "1" }] };
      if (s.includes("pipeline") || s.includes("cards") || s.includes("dispute_letters")) {
        return { rows: [{ stage_id: "s1", pipeline_id: "p1", id: "c1" }] };
      }
      return { rows: [] };
    }
  };
  const req = {
    method: "POST",
    body: {
      mail: true,
      client_id: "33333333-3333-4333-8333-333333333333",
      mail_from: {
        first_name: "Pat",
        last_name: "Client",
        address_line1: "12 Oak St",
        address_city: "Dallas",
        address_state: "TX",
        address_zip: "75201"
      },
      letters: [{ bureau: "EX", pdf: "JVBERi0=" }]
    }
  };
  const res = resCapture();
  await handler(req, res, {
    db,
    requireAuth: async () => ({
      id: "44444444-4444-4444-8444-444444444444",
      org_id: "22222222-2222-4222-8222-222222222222",
      role: "owner"
    }),
    mailBureauLetter: async (opts) => {
      mailCalls.push(opts);
      return { ok: true, providerId: "letter_dfy_1" };
    }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(mailCalls.length, 1);
  assert.equal(mailCalls[0].bureau, "EX");
  assert.equal(mailCalls[0].pdf, "JVBERi0=");
  assert.equal(mailCalls[0].from.first_name, "Pat");
});

test("repair send without mail=true fails closed", async () => {
  const mailCalls = [];
  const res = resCapture();
  await handler({
    method: "POST",
    body: {
      mail: false,
      client_id: "33333333-3333-4333-8333-333333333333",
      letters: [{ bureau: "EX", html: "<p>x</p>" }]
    }
  }, res, {
    db: { async query() { return { rows: [{ id: "1" }] }; } },
    requireAuth: async () => ({
      id: "44444444-4444-4444-8444-444444444444",
      org_id: "22222222-2222-4222-8222-222222222222",
      role: "owner"
    }),
    mailBureauLetter: async (opts) => { mailCalls.push(opts); return { ok: true, providerId: "x" }; }
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, "no_channel");
  assert.equal(mailCalls.length, 0);
});

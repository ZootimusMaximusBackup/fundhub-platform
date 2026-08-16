// Email-channel prove — unit tests. No live database, no live Resend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ORG,
  RESEND_TEST_INBOX,
  SAMPLE_CLIENT_EMAIL,
  SKIP_PACKS,
  SKIP_REPAIR_DELIVERY,
  PASSED_BODY_ONLY,
  WORKFLOW_IF_NOT_DRAFT,
  PROVE_KEYS,
  isGhlLeftoverKey,
  rewriteOutboundToGmail,
  dispatchQueued,
  skipReason,
  proveSubject,
  proveOneKey,
  proveEmailChannel
} from "./tmp-email-channel-prove.mjs";

const SRC = readFileSync(fileURLToPath(new URL("./tmp-email-channel-prove.mjs", import.meta.url)), "utf8");

function fakeDb(handlers = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      for (const [fragment, rows] of Object.entries(handlers)) {
        if (sql.includes(fragment)) {
          const value = typeof rows === "function" ? rows(sql, params) : rows;
          return Array.isArray(value) ? { rows: value, rowCount: value.length } : value;
        }
      }
      return { rows: [], rowCount: 0 };
    }
  };
}

function trackingDispatch() {
  const calls = [];
  async function dispatchMessage(database, messageId, opts) {
    calls.push({ messageId, envDryRun: opts?.env?.MESSAGING_DRY_RUN, orderMark: "dispatch" });
    return { outcome: "sent", detail: "prov-id" };
  }
  return { calls, dispatchMessage };
}

test("inbox is Gmail without a plus-alias; sample client keeps the plus-alias", () => {
  assert.equal(RESEND_TEST_INBOX, "stanbridgejchris@gmail.com");
  assert.equal(RESEND_TEST_INBOX.includes("+"), false);
  assert.equal(SAMPLE_CLIENT_EMAIL, "stanbridgejchris+full@gmail.com");
  assert.match(SAMPLE_CLIENT_EMAIL, /\+/);
});

test("prove key lists match the board (packs and repair delivery excluded)", () => {
  assert.deepEqual([...PASSED_BODY_ONLY], [
    "CONTRACT-REMIND-EMAIL",
    "CONTRACT-SEND-EMAIL",
    "EMAIL-PORTAL-MAGIC-LINK",
    "INVOICE-SENT-EMAIL"
  ]);
  assert.equal(SKIP_REPAIR_DELIVERY, "EMAIL-U02-ANALYZER-REPAIR-DELIVERY");
  assert.ok(SKIP_PACKS.includes("EMAIL-U02-ANALYZER-FUNDING-DELIVERY"));
  assert.ok(SKIP_PACKS.includes("EMAIL-DS02-DIY-LETTERS-READY"));
  assert.equal(PROVE_KEYS.includes(SKIP_REPAIR_DELIVERY), false);
  assert.equal(PROVE_KEYS.some((k) => SKIP_PACKS.includes(k)), false);
  assert.ok(WORKFLOW_IF_NOT_DRAFT.includes("EMAIL-C06-DECLINE"));
  assert.ok(WORKFLOW_IF_NOT_DRAFT.includes("EMAIL-DS01-REPAIR-REFERRAL"));
});

test("GHL leftover keys are skipped; workflow EMAIL-* keys are not", () => {
  assert.equal(isGhlLeftoverKey("FR22"), true);
  assert.equal(isGhlLeftoverKey("BS-FUND-1"), true);
  assert.equal(isGhlLeftoverKey("LT-01"), true);
  assert.equal(isGhlLeftoverKey("AF1"), true);
  assert.equal(isGhlLeftoverKey("EMAIL-F07-FUNDING-LOCKED"), false);
  assert.equal(isGhlLeftoverKey("EMAIL-N01-COLD-NURTURE"), false);
});

test("skipReason: draft, missing, repair delivery, packs", () => {
  assert.equal(skipReason(SKIP_REPAIR_DELIVERY, { body: "real", channel: "email" }), "skip_repair_delivery");
  assert.equal(skipReason("EMAIL-U02-ANALYZER-FUNDING-DELIVERY", { body: "real", channel: "email" }), "skip_pack_already_sent");
  assert.equal(skipReason("FR22", { body: "real", channel: "email" }), "skip_ghl_leftover");
  assert.equal(skipReason("EMAIL-N01-COLD-NURTURE", null), "missing");
  assert.equal(
    skipReason("EMAIL-N01-COLD-NURTURE", { body: "[DRAFT] placeholder", subject: "Hi", channel: "email" }),
    "draft"
  );
  assert.equal(
    skipReason("EMAIL-N01-COLD-NURTURE", { body: "Hello {{contact.first_name}}", subject: "Hi", channel: "email" }),
    null
  );
});

test("proveSubject prefixes [PROVE]", () => {
  assert.equal(proveSubject("Please sign"), "[PROVE] Please sign");
  assert.equal(proveSubject(""), "[PROVE]");
});

test("source: rewrite targets messages.to_address only; never SET clients.email", () => {
  assert.match(SRC, /UPDATE messages SET to_address = \$2 WHERE id = \$1 AND direction = 'outbound'/);
  assert.doesNotMatch(SRC, /UPDATE\s+clients[\s\S]{0,400}\bemail\s*=/);
  assert.doesNotMatch(SRC, /UPDATE\s+message_templates/i);
  assert.doesNotMatch(SRC, /compliance_passed\s*=/);
  assert.doesNotMatch(SRC, /claimDue/);
  assert.doesNotMatch(SRC, /dispatchDue/);
  assert.doesNotMatch(SRC, /--prod/);
  assert.doesNotMatch(SRC, /channel:\s*['"]sms['"]/);
  assert.match(SRC, /attachments/);
  assert.match(SRC, /'\[\]'::jsonb/);
});

test("source: dispatchQueued rewrites then one-shot dispatchMessage", () => {
  const fn = SRC.slice(SRC.indexOf("export async function dispatchQueued"));
  const body = fn.slice(0, fn.indexOf("export async function proveOneKey"));
  assert.match(body, /rewriteOutboundToGmail/);
  assert.match(body, /dispatchMessage/);
});

test("rewriteOutboundToGmail writes to_address to the inbox and never touches clients", async () => {
  const database = fakeDb({
    "UPDATE messages SET to_address": (sql, params) => {
      assert.equal(params[0], "msg-1");
      assert.equal(params[1], RESEND_TEST_INBOX);
      assert.match(sql, /direction = 'outbound'/);
      assert.doesNotMatch(sql, /clients/);
      return { rows: [{ id: "msg-1", to_address: RESEND_TEST_INBOX }], rowCount: 1 };
    }
  });
  const out = await rewriteOutboundToGmail(database, "msg-1");
  assert.equal(out.rewritten, true);
  assert.equal(out.to_address, RESEND_TEST_INBOX);
});

test("dispatchQueued refuses to send when rewrite matches no row", async () => {
  const { calls, dispatchMessage } = trackingDispatch();
  const database = fakeDb({
    "UPDATE messages SET to_address": { rows: [], rowCount: 0 }
  });
  const out = await dispatchQueued("msg-missing", { db: database, dispatchMessage });
  assert.equal(out.outcome, "skipped");
  assert.equal(out.detail, "rewrite_failed");
  assert.equal(calls.length, 0);
});

test("dispatchQueued rewrites then dispatches with dry-run off", async () => {
  const { calls, dispatchMessage } = trackingDispatch();
  const database = fakeDb({
    "UPDATE messages SET to_address": { rows: [{ id: "msg-1", to_address: RESEND_TEST_INBOX }] }
  });
  const out = await dispatchQueued("msg-1", { db: database, dispatchMessage });
  assert.equal(out.outcome, "sent");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messageId, "msg-1");
  assert.equal(calls[0].envDryRun, "0");
});

test("proveOneKey skips repair delivery without inserting", async () => {
  const { calls, dispatchMessage } = trackingDispatch();
  const database = fakeDb();
  const out = await proveOneKey(SKIP_REPAIR_DELIVERY, {
    client: { id: "c1", email: SAMPLE_CLIENT_EMAIL },
    deps: { db: database, dispatchMessage }
  });
  assert.equal(out.skipped, true);
  assert.equal(out.reason, "skip_repair_delivery");
  assert.equal(calls.length, 0);
  assert.equal(database.queries.length, 0);
});

test("proveEmailChannel queues body-only, rewrites, one-shots", async () => {
  const { calls, dispatchMessage } = trackingDispatch();
  const database = fakeDb({
    "FROM message_templates": [{
      template_key: "EMAIL-N01-COLD-NURTURE",
      channel: "email",
      subject: "Hi {{contact.first_name}}",
      body: "Hello {{contact.first_name}}",
      compliance_passed: false
    }],
    "INSERT INTO messages": { rows: [{ id: "msg-new" }] },
    "UPDATE messages SET to_address": { rows: [{ id: "msg-new", to_address: RESEND_TEST_INBOX }] }
  });
  const out = await proveEmailChannel({
    db: database,
    dispatchMessage,
    captureHttp: false,
    keys: ["EMAIL-N01-COLD-NURTURE"],
    client: {
      id: "c-full",
      email: SAMPLE_CLIENT_EMAIL,
      first_name: "Chris",
      last_name: "Full",
      custom_fields: {}
    }
  });
  assert.equal(out.ok, true);
  assert.equal(out.sent.length, 1);
  assert.equal(out.sent[0].key, "EMAIL-N01-COLD-NURTURE");
  assert.equal(calls.length, 1);
  const insert = database.queries.find((q) => q.sql.includes("INSERT INTO messages"));
  assert.ok(insert);
  assert.equal(insert.params[2], "EMAIL-N01-COLD-NURTURE");
  assert.equal(insert.params[3], "Hello Chris");
  assert.match(insert.params[6], /^\[PROVE\] Hi Chris$/);
  assert.equal(insert.params[5], SAMPLE_CLIENT_EMAIL);
  assert.equal(out.inbox, RESEND_TEST_INBOX);
  assert.equal(ORG, "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6");
});

test("isUsableDatabaseUrl rejects masked CLI values", async () => {
  const { isUsableDatabaseUrl } = await import("./tmp-email-channel-prove.mjs");
  assert.equal(isUsableDatabaseUrl(""), false);
  assert.equal(isUsableDatabaseUrl("********************"), false);
  assert.equal(isUsableDatabaseUrl("postgresql://u:p@db.example.com:5432/postgres"), true);
});

test("proveEmailChannel skips [DRAFT] without dispatch", async () => {
  const { calls, dispatchMessage } = trackingDispatch();
  const database = fakeDb({
    "FROM message_templates": [{
      template_key: "EMAIL-N01-COLD-NURTURE",
      channel: "email",
      subject: "[DRAFT] x",
      body: "[DRAFT] y",
      compliance_passed: false
    }]
  });
  const out = await proveEmailChannel({
    db: database,
    dispatchMessage,
    keys: ["EMAIL-N01-COLD-NURTURE"],
    client: { id: "c-full", email: SAMPLE_CLIENT_EMAIL, first_name: "Chris", last_name: "Full", custom_fields: {} }
  });
  assert.equal(out.ok, true);
  assert.equal(out.sent.length, 0);
  assert.equal(out.skipped[0].reason, "draft");
  assert.equal(calls.length, 0);
});

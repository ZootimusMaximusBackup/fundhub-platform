// Gauntlet Gmail rewrite — unit tests. No live database, no live Resend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ORG,
  ROSTER,
  RESEND_TEST_INBOX,
  rewriteOutboundToGmail,
  dispatchQueued,
  retryHeldSampleMail,
  sendUiqDeliverables,
  runGauntlet
} from "./tmp-letter-gauntlet.mjs";

const SRC = readFileSync(fileURLToPath(new URL("./tmp-letter-gauntlet.mjs", import.meta.url)), "utf8");

const FOUR_ANALYSIS = [
  { filename: "credit-analysis.pdf" },
  { filename: "optimization-roadmap.pdf" },
  { filename: "funding-snapshot.pdf" },
  { filename: "lender-match.pdf" }
];

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
    return { outcome: "sent" };
  }
  return { calls, dispatchMessage };
}

test("RESEND_TEST_INBOX is the onboarding Gmail, not a plus-alias", () => {
  assert.equal(RESEND_TEST_INBOX, "stanbridgejchris@gmail.com");
  assert.equal(RESEND_TEST_INBOX.includes("+"), false);
});

test("MANUAL_REVIEW roster row is mail none and keeps a plus-alias on the client", () => {
  const review = ROSTER.find((r) => r.tier === "MANUAL_REVIEW");
  assert.ok(review);
  assert.equal(review.mail, "none");
  assert.equal(review.key, "review");
  assert.match(review.email, /stanbridgejchris\+review@gmail\.com/i);
});

test("source: rewrite targets messages.to_address only; never SET clients.email", () => {
  assert.match(SRC, /UPDATE messages SET to_address = \$2 WHERE id = \$1 AND direction = 'outbound'/);
  assert.doesNotMatch(SRC, /UPDATE\s+clients[\s\S]{0,400}\bemail\s*=/);
  assert.match(SRC, /export async function rewriteOutboundToGmail/);
});

test("source: sendUiqDeliverables, runGauntlet, retryHeldSampleMail all go through dispatchQueued", () => {
  const dispatchFn = SRC.slice(SRC.indexOf("export async function dispatchQueued"));
  const dispatchBody = dispatchFn.slice(0, dispatchFn.indexOf("export async function retryHeldSampleMail"));
  assert.match(dispatchBody, /rewriteOutboundToGmail/);
  assert.match(dispatchBody, /dispatchMessage/);

  const sendFn = SRC.slice(SRC.indexOf("export async function sendUiqDeliverables"));
  const sendBody = sendFn.slice(0, sendFn.indexOf("function analysisEvent"));
  assert.match(sendBody, /dispatchQueued\(/);
  assert.doesNotMatch(sendBody, /dispatchMessage\(/);

  const retryFn = SRC.slice(SRC.indexOf("export async function retryHeldSampleMail"));
  const retryBody = retryFn.slice(0, retryFn.indexOf("export async function sendUiqDeliverables"));
  assert.match(retryBody, /dispatchQueued\(/);
  assert.doesNotMatch(retryBody, /dispatchMessage\(/);

  const runFn = SRC.slice(SRC.indexOf("export async function runGauntlet"));
  const runBody = runFn.slice(0, runFn.indexOf("const isMain"));
  assert.match(runBody, /dispatchQueued\(/);
  assert.equal((runBody.match(/dispatchMessage\(/g) || []).length, 0);
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
  assert.equal(database.queries.every((q) => /UPDATE messages/.test(q.sql)), true);
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

test("dispatchQueued rewrites to_address before dispatchMessage", async () => {
  const order = [];
  const { calls, dispatchMessage: inner } = trackingDispatch();
  const database = fakeDb({
    "UPDATE messages SET to_address": (sql, params) => {
      order.push("rewrite");
      return { rows: [{ id: params[0], to_address: params[1] }], rowCount: 1 };
    }
  });
  async function dispatchMessage(d, id, opts) {
    order.push("dispatch");
    return inner(d, id, opts);
  }
  const out = await dispatchQueued("msg-ok", { db: database, dispatchMessage });
  assert.equal(out.outcome, "sent");
  assert.deepEqual(order, ["rewrite", "dispatch"]);
  assert.equal(calls[0].messageId, "msg-ok");
  assert.equal(database.queries[0].params[1], RESEND_TEST_INBOX);
});

test("retryHeldSampleMail rewrites each sample row and does not drain the whole outbox", async () => {
  const { calls, dispatchMessage } = trackingDispatch();
  const database = fakeDb({
    "SELECT m.id": [{ id: "held-1" }, { id: "held-2" }],
    "UPDATE messages SET to_address": (sql, params) => ({
      rows: [{ id: params[0], to_address: RESEND_TEST_INBOX }],
      rowCount: 1
    })
  });
  const out = await retryHeldSampleMail({ db: database, dispatchMessage });
  assert.equal(out.ok, true);
  assert.equal(out.count, 2);
  assert.equal(calls.length, 2);

  const select = database.queries.find((q) => q.sql.includes("SELECT m.id"));
  assert.ok(select);
  assert.match(select.sql, /stanbridgejchris\+%/);
  assert.match(select.sql, /m\.status = 'queued'/);
  assert.match(select.sql, /c\.org_id = \$1/);
  assert.equal(select.params[0], ORG);
  assert.ok(select.params[1].includes("stanbridgejchris+review@gmail.com"));
  assert.equal(database.queries.filter((q) => /UPDATE messages SET to_address/.test(q.sql)).length, 2);
});

test("sendUiqDeliverables skips MANUAL_REVIEW even if that email is requested", async () => {
  const { calls, dispatchMessage } = trackingDispatch();
  const database = fakeDb();
  const out = await sendUiqDeliverables({
    emails: ["stanbridgejchris+review@gmail.com"],
    db: database,
    dispatchMessage,
    sendTemplated: async () => ({ sent: true, messageId: "should-not-send" }),
    buildLetterPackForClient: async () => ({ files: FOUR_ANALYSIS, deliverableCount: 4 })
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "no_clients");
  assert.equal(calls.length, 0);
  assert.equal(database.queries.length, 0);
});

test("sendUiqDeliverables rewrites to_address before send; does not SET clients.email", async () => {
  const { calls, dispatchMessage } = trackingDispatch();
  let templated = 0;
  const database = fakeDb({
    "SELECT id, email FROM clients": [{ id: "c-full", email: "stanbridgejchris+full@gmail.com" }],
    "UPDATE messages SET to_address": (sql, params) => ({
      rows: [{ id: params[0], to_address: RESEND_TEST_INBOX }],
      rowCount: 1
    }),
    "UPDATE clients": { rows: [], rowCount: 1 }
  });
  const out = await sendUiqDeliverables({
    emails: ["stanbridgejchris+full@gmail.com"],
    db: database,
    dispatchMessage,
    sendTemplated: async () => {
      templated += 1;
      return { sent: true, messageId: "msg-full" };
    },
    buildLetterPackForClient: async () => ({ files: FOUR_ANALYSIS, deliverableCount: 4 })
  });
  assert.equal(out.ok, true);
  assert.equal(templated, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messageId, "msg-full");
  const rewrite = database.queries.find((q) => /UPDATE messages SET to_address/.test(q.sql));
  assert.equal(rewrite.params[1], RESEND_TEST_INBOX);
  for (const q of database.queries) {
    if (/UPDATE\s+clients/i.test(q.sql)) {
      assert.doesNotMatch(q.sql, /\bemail\s*=/);
    }
  }
});

test("sendUiqDeliverables missing analysis PDFs does not dispatch", async () => {
  const { calls, dispatchMessage } = trackingDispatch();
  const database = fakeDb({
    "SELECT id, email FROM clients": [{ id: "c-full", email: "stanbridgejchris+full@gmail.com" }]
  });
  const out = await sendUiqDeliverables({
    db: database,
    dispatchMessage,
    sendTemplated: async () => ({ sent: true, messageId: "nope" }),
    buildLetterPackForClient: async () => ({ files: [{ filename: "one.pdf" }], deliverableCount: 1 })
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "missing_uiq_docs");
  assert.equal(calls.length, 0);
});

test("runGauntlet: three funding + one repair dispatch; MANUAL_REVIEW never sends", async () => {
  const { calls, dispatchMessage } = trackingDispatch();
  const clients = new Map();
  const database = fakeDb({
    "SELECT id FROM clients": (sql, params) => {
      const email = params[1];
      const existing = [...clients.values()].find((c) => c.email === email);
      return existing ? [{ id: existing.id }] : [];
    },
    "INSERT INTO clients": (sql, params) => {
      const id = `c-${params[3]}`;
      clients.set(id, { id, email: params[3] });
      return { rows: [{ id }], rowCount: 1 };
    },
    "SELECT id FROM crs_results": [{ id: "crs-1" }],
    "UPDATE crs_results": { rows: [], rowCount: 1 },
    "UPDATE clients": { rows: [], rowCount: 1 },
    "UPDATE messages SET to_address": (sql, params) => ({
      rows: [{ id: params[0], to_address: RESEND_TEST_INBOX }],
      rowCount: 1
    })
  });

  const u02Calls = [];
  const out = await runGauntlet({
    db: database,
    dispatchMessage,
    buildLetterPackForClient: async () => ({ files: FOUR_ANALYSIS, deliverableCount: 4 }),
    u02: async ({ event, generatePack }) => {
      u02Calls.push({ tier: event.payload.outcomeTier, clientId: event.clientId });
      const pack = await generatePack();
      if (!pack?.files?.length) {
        return { done: true, branch: "unknown_path", outcomeTier: event.payload.outcomeTier };
      }
      return {
        done: true,
        branch: "funding",
        email: { sent: true, messageId: `msg-${event.clientId}` },
        attachmentCount: pack.files.length
      };
    },
    ds02: async ({ event }) => ({
      done: true,
      email: { sent: true, messageId: `msg-${event.clientId}`, attachmentCount: 2 }
    })
  });

  assert.equal(out.ok, true);
  const review = out.people.find((p) => p.tier === "MANUAL_REVIEW");
  assert.equal(review.dispatch, "skipped");
  assert.equal(review.queued, false);
  assert.equal(out.people.filter((p) => ["full", "fpr", "prem"].includes(p.key) && p.dispatch === "sent").length, 3);
  assert.equal(out.people.find((p) => p.key === "repair").dispatch, "sent");
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c.messageId.startsWith("msg-")));
  assert.ok(!calls.some((c) => String(c.messageId).includes("review")));

  const reviewU02 = u02Calls.find((c) => c.tier === "MANUAL_REVIEW");
  assert.ok(reviewU02);
  assert.ok(!calls.some((c) => c.messageId === `msg-${reviewU02.clientId}`));

  for (const q of database.queries) {
    if (/UPDATE\s+clients/i.test(q.sql)) {
      assert.doesNotMatch(q.sql, /\bemail\s*=/);
    }
    if (/INSERT INTO clients/.test(q.sql)) {
      assert.notEqual(q.params[3], RESEND_TEST_INBOX);
      assert.match(q.params[3], /stanbridgejchris\+/);
    }
  }
  assert.equal(database.queries.filter((q) => /UPDATE messages SET to_address/.test(q.sql)).length, 4);
});

test("tests never import the live Resend provider", () => {
  const testSrc = readFileSync(fileURLToPath(new URL("./tmp-letter-gauntlet.test.mjs", import.meta.url)), "utf8");
  assert.doesNotMatch(testSrc, /providers\/resend/);
  assert.doesNotMatch(SRC, /fetch\s*\(/);
});

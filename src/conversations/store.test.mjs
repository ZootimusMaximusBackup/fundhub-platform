// Unit tests for the conversation writer's argument handling and the shape of
// the SQL it issues. The behaviour of that SQL against real constraints — the
// upsert collapsing onto one row, GREATEST actually ignoring NULLs — is proven
// in store.pg.test.mjs against Postgres, because a fake that models the schema
// I wish existed cannot fail when the real schema moves.
//
// What IS worth asserting here is what the statements do and do not mention.
// "conversations.sentiment is never written" is a rule about the text of the
// query, and it is exactly the kind of rule a later well-meaning edit breaks.

import { test } from "node:test";
import assert from "node:assert";
import { upsertConversation, listConversations, linkMessage } from "./store.mjs";

// Records every statement; returns whatever the caller stubs.
function recordingDb(result = { rows: [] }) {
  const calls = [];
  return {
    calls,
    last: () => calls[calls.length - 1],
    async query(sql, params) {
      calls.push({ sql, params });
      return typeof result === "function" ? result(sql, params) : result;
    }
  };
}

const ROW = { rows: [{ id: "cv-1", channel: "sms", sentiment: null }] };

// --- the headline rule ------------------------------------------------------

test("upsertConversation: the sentiment column is never named, so Hot/Warm/Cold is never guessed", async () => {
  const db = recordingDb(ROW);
  await upsertConversation(db, { orgId: "org-1", clientId: "cl-1", channel: "sms", lastPulseAt: "2026-07-30T10:00:00Z" });
  assert.equal(/sentiment/i.test(db.last().sql), false, "no statement here may write or read sentiment");
});

test("upsertConversation: no argument named sentiment can smuggle a value into the row", async () => {
  const db = recordingDb(ROW);
  await upsertConversation(db, { orgId: "org-1", clientId: "cl-1", channel: "sms", sentiment: "Hot" });
  assert.equal(db.last().params.includes("Hot"), false, "an unsupported sentiment argument is ignored, not bound");
  assert.equal(db.last().params.length, 5, "org, client, channel, summary, last_pulse_at — and nothing else");
});

// --- refusing to write a half-identified thread ------------------------------

test("upsertConversation: a missing orgId throws rather than inserting an unowned thread", async () => {
  const db = recordingDb(ROW);
  await assert.rejects(() => upsertConversation(db, { clientId: "cl-1", channel: "sms" }), TypeError);
  assert.equal(db.calls.length, 0, "nothing is sent to the database");
});

test("upsertConversation: a missing clientId throws rather than relying on the NOT NULL to catch it", async () => {
  const db = recordingDb(ROW);
  await assert.rejects(() => upsertConversation(db, { orgId: "org-1", channel: "sms" }), TypeError);
  assert.equal(db.calls.length, 0);
});

test("upsertConversation: a blank channel throws rather than creating a thread with no channel", async () => {
  const db = recordingDb(ROW);
  await assert.rejects(() => upsertConversation(db, { orgId: "org-1", clientId: "cl-1", channel: "   " }), TypeError);
  await assert.rejects(() => upsertConversation(db, { orgId: "org-1", clientId: "cl-1" }), TypeError);
  assert.equal(db.calls.length, 0);
});

// --- the channel is the messages row's channel, verbatim ---------------------

test("upsertConversation: channel case is preserved, because the thread must match the messages row byte for byte", async () => {
  const db = recordingDb(ROW);
  await upsertConversation(db, { orgId: "org-1", clientId: "cl-1", channel: "SMS" });
  assert.equal(db.last().params[2], "SMS", "case folding here would split one client's thread in two");
});

test("upsertConversation: surrounding whitespace is trimmed off the channel", async () => {
  const db = recordingDb(ROW);
  await upsertConversation(db, { orgId: "org-1", clientId: "cl-1", channel: " voice " });
  assert.equal(db.last().params[2], "voice");
});

// --- unknowns stay unknown ---------------------------------------------------

test("upsertConversation: an absent summary binds SQL NULL, never the string 'undefined'", async () => {
  const db = recordingDb(ROW);
  await upsertConversation(db, { orgId: "org-1", clientId: "cl-1", channel: "sms" });
  assert.equal(db.last().params[3], null);
});

test("upsertConversation: an absent lastPulseAt binds NULL rather than the current clock", async () => {
  const db = recordingDb(ROW);
  await upsertConversation(db, { orgId: "org-1", clientId: "cl-1", channel: "sms" });
  assert.equal(db.last().params[4], null, "an unknown pulse time is not now()");
});

test("upsertConversation: a summary-less update COALESCEs so it cannot erase a summary already stored", async () => {
  const db = recordingDb(ROW);
  await upsertConversation(db, { orgId: "org-1", clientId: "cl-1", channel: "sms" });
  assert.match(db.last().sql, /summary\s*=\s*COALESCE\(EXCLUDED\.summary,\s*conversations\.summary\)/);
});

test("upsertConversation: last_pulse_at is GREATEST-ed so an out-of-order webhook cannot rewind the thread", async () => {
  const db = recordingDb(ROW);
  await upsertConversation(db, { orgId: "org-1", clientId: "cl-1", channel: "sms", lastPulseAt: "2026-07-30T10:00:00Z" });
  assert.match(db.last().sql, /last_pulse_at\s*=\s*GREATEST\(EXCLUDED\.last_pulse_at,\s*conversations\.last_pulse_at\)/);
});

// --- shape ------------------------------------------------------------------

test("upsertConversation: the conflict target is (client_id, channel), the unique index migration 057 adds", async () => {
  const db = recordingDb(ROW);
  await upsertConversation(db, { orgId: "org-1", clientId: "cl-1", channel: "sms" });
  assert.match(db.last().sql, /ON CONFLICT \(client_id, channel\) DO UPDATE/);
});

test("upsertConversation: returns the stored row rather than a boolean", async () => {
  const db = recordingDb(ROW);
  const row = await upsertConversation(db, { orgId: "org-1", clientId: "cl-1", channel: "sms" });
  assert.equal(row.id, "cv-1");
});

// --- reader -----------------------------------------------------------------

test("listConversations: a never-pulsed thread sorts last, not first, via NULLS LAST", async () => {
  const db = recordingDb({ rows: [] });
  await listConversations(db, { clientId: "cl-1" });
  assert.match(db.last().sql, /ORDER BY last_pulse_at DESC NULLS LAST/);
});

test("listConversations: ties break on channel so repeated calls return a stable order", async () => {
  const db = recordingDb({ rows: [] });
  await listConversations(db, { clientId: "cl-1" });
  assert.match(db.last().sql, /NULLS LAST,\s*channel ASC/);
});

test("listConversations: a missing clientId throws rather than listing every client's threads", async () => {
  const db = recordingDb({ rows: [] });
  await assert.rejects(() => listConversations(db, {}), TypeError);
  assert.equal(db.calls.length, 0);
});

// --- linker -----------------------------------------------------------------

test("linkMessage: the update requires the thread's org and client to match the message's", async () => {
  const db = recordingDb({ rows: [{ id: "ms-1" }] });
  await linkMessage(db, { messageId: "ms-1", conversationId: "cv-1" });
  assert.match(db.last().sql, /c\.org_id = m\.org_id/, "a cross-org link would disclose another org's message");
  assert.match(db.last().sql, /c\.client_id = m\.client_id/, "a cross-client link puts one client's SMS in another's history");
});

test("linkMessage: a match reports linked true", async () => {
  const db = recordingDb({ rows: [{ id: "ms-1" }] });
  assert.deepEqual(await linkMessage(db, { messageId: "ms-1", conversationId: "cv-1" }), { linked: true });
});

test("linkMessage: no match reports linked false rather than throwing, because an unlinkable message is normal", async () => {
  const db = recordingDb({ rows: [] });
  assert.deepEqual(await linkMessage(db, { messageId: "ms-9", conversationId: "cv-9" }), { linked: false });
});

test("linkMessage: a missing id throws rather than issuing an UPDATE with a NULL predicate", async () => {
  const db = recordingDb({ rows: [] });
  await assert.rejects(() => linkMessage(db, { conversationId: "cv-1" }), TypeError);
  await assert.rejects(() => linkMessage(db, { messageId: "ms-1" }), TypeError);
  assert.equal(db.calls.length, 0);
});

import { test } from "node:test";
import assert from "node:assert";
import { sendTemplated } from "./messaging.mjs";

// In-memory DB fake covering message_templates, messages, opt_outs, conversations,
// and the client record sendTemplated reads merge-tag context from.
function pgFake({ templates = [], optOuts = [], clients = [], openShift = null, failOn = null } = {}) {
  const messages = [];
  const conversations = [];   // (client_id, channel) threads for Messaging inbox
  const events = [];          // staff_events, the telemetry seam's output
  const sql = [];             // every statement issued, so a test can assert one was NOT
  return {
    messages,
    conversations,
    events,
    sql,
    optOuts,
    clients,
    async query(statement, params = []) {
      const sql = statement;
      this.sql.push(String(statement));
      if (failOn && failOn.test(sql)) throw Object.assign(new Error("simulated outage"), { code: "08006" });
      if (/SELECT first_name, last_name, email, phone, custom_fields FROM clients/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [c] : [] };
      }
      if (/SELECT body,\s*subject(?:\s*,\s*compliance_passed)?[\s\S]*?FROM message_templates/.test(sql)) {
        const [orgId, key] = params;
        const t = templates.find((t) => t.org_id === orgId && t.template_key === key);
        return { rows: t ? [{ body: t.body, subject: t.subject || null, compliance_passed: !!t.compliance_passed }] : [] };
      }
      if (/SELECT 1 FROM opt_outs/.test(sql)) {
        const r = optOuts.find((o) => o.client_id === params[0] && o.channel === params[1] && !o.opted_in_at);
        return { rows: r ? [{ 1: 1 }] : [] };
      }
      // staff_events before the generic branches: its statement also RETURNINGs.
      if (/INSERT INTO staff_events/.test(sql)) {
        const ev = { staff_id: params[0], org_id: params[1], shift_id: params[2], kind: params[3], detail: JSON.parse(params[4]) };
        events.push(ev);
        return { rows: [{ id: "ev-" + events.length, ...ev }] };
      }
      if (/FROM shifts/.test(sql)) return { rows: openShift ? [{ id: openShift }] : [] };
      if (/INSERT INTO messages/.test(sql)) {
        // ON CONFLICT (org_id, provider_ref) DO NOTHING, modelled: a replay of
        // the same event writes nothing and RETURNS no row.
        const dup = messages.some((m) => m.org_id === params[0] && m.provider_ref === params[5]);
        if (dup) return { rows: [] };
        let attachments = [];
        if (params[8] != null) {
          try { attachments = JSON.parse(params[8]); } catch { attachments = []; }
        }
        const created_at = new Date("2026-08-14T12:00:00.000Z");
        const msg = {
          id: "msg-" + (messages.length + 1),
          org_id: params[0], client_id: params[1], channel: params[2],
          template_key: params[3], rendered_body: params[4], provider_ref: params[5],
          to_address: params[6], subject: params[7], attachments,
          conversation_id: null, created_at
        };
        messages.push(msg);
        return { rows: [{ id: msg.id, created_at }] };
      }
      // upsertConversation — one row per (client_id, channel); conflict refreshes pulse.
      if (/INSERT INTO conversations/.test(sql)) {
        const [orgId, clientId, channel, summary, lastPulseAt] = params;
        let existing = conversations.find((c) => c.client_id === clientId && c.channel === channel);
        if (existing) {
          if (summary != null) existing.summary = summary;
          if (lastPulseAt != null) {
            existing.last_pulse_at = existing.last_pulse_at && existing.last_pulse_at > lastPulseAt
              ? existing.last_pulse_at
              : lastPulseAt;
          }
          return { rows: [existing] };
        }
        existing = {
          id: "convo-" + (conversations.length + 1),
          org_id: orgId, client_id: clientId, channel,
          summary: summary ?? null, last_pulse_at: lastPulseAt ?? null
        };
        conversations.push(existing);
        return { rows: [existing] };
      }
      // linkMessage — set conversation_id when org + client match the thread.
      if (/UPDATE messages m[\s\S]*SET conversation_id/.test(sql)) {
        const [messageId, conversationId] = params;
        const msg = messages.find((m) => m.id === messageId);
        const convo = conversations.find((c) => c.id === conversationId);
        if (!msg || !convo) return { rows: [] };
        if (convo.org_id !== msg.org_id || convo.client_id !== msg.client_id) return { rows: [] };
        msg.conversation_id = conversationId;
        return { rows: [{ id: msg.id }] };
      }
      return { rows: [] };
    }
  };
}

async function quietly(fn) {
  const real = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(" "));
  try { return { value: await fn(), lines }; } finally { console.error = real; }
}

const BASE = { orgId: "org-1", clientId: "cl-1", channel: "sms", eventId: "evt-1" };

const tpl = (key, body) => ({ org_id: "org-1", template_key: key, body, compliance_passed: true });

test("sendTemplated: normal send queues a message with rendered body", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hi {{first_name}}, apply now!")] });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", context: { first_name: "Alice" } });
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0].rendered_body, "Hi Alice, apply now!");
  assert.ok(db.messages[0].conversation_id, "queued row must join a Messaging thread");
});

test("sendTemplated: opted-out contact is suppressed (not dispatched)", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "Hi {{first_name}}")],
    optOuts: [{ client_id: "cl-1", channel: "sms", opted_in_at: null }]
  });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", context: { first_name: "Alice" } });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "opted_out");
  assert.equal(db.messages.length, 0, "no message row inserted for opted-out contact");
});

test("sendTemplated: opted-in contact (opted_in_at set) sends normally", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "Hey!")],
    optOuts: [{ client_id: "cl-1", channel: "sms", opted_in_at: new Date() }]
  });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 1);
});

test("sendTemplated: missing template returns template_pending", async () => {
  const db = pgFake({ templates: [] });
  const res = await sendTemplated(db, { ...BASE, templateKey: "GHOST" });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "template_pending");
});

test("sendTemplated: unknown merge token renders blank, send still queued", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Score: {{score}} — {{unknown}}")] });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", context: { score: "720" } });
  assert.equal(res.sent, true);
  assert.equal(db.messages[0].rendered_body, "Score: 720 — ");
});

// --- merge-tag context off the client record --------------------------------
// THE BUG: every sendTemplated call site in src/workflows passes no `context`, so the
// ported GHL copy's `{{contact.*}}` tags had nothing to resolve against — and with the
// old TOKEN_RE they rendered literally into live SMS and email.

const client = (over = {}) => ({
  id: "cl-1", first_name: "Alice", last_name: "Nguyen", email: "alice@example.com",
  phone: "+15551234567", custom_fields: {}, ...over
});

test("REGRESSION: {{contact.first_name}} resolves from the client record with no context passed", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey {{contact.first_name}}, ready?")], clients: [client()] });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(res.sent, true);
  assert.equal(db.messages[0].rendered_body, "Hey Alice, ready?");
});

test("REGRESSION: no merge tag survives into the queued body with braces intact", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "Hey {{contact.first_name}}, pre-approved for {{contact.analyzer_prequal_amount}}.")],
    clients: [client({ custom_fields: { analyzer_prequal_amount: 50000 } })]
  });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  const body = db.messages[0].rendered_body;
  assert.equal(body, "Hey Alice, pre-approved for 50000.");
  assert.ok(!body.includes("{{"), "an unrendered merge tag must never reach an outbound body");
});

test("custom_fields are reachable as contact.* — the 252 ported GHL fields", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "{{contact.business_name}} owes {{contact.total_funding_estimate}}")],
    clients: [client({ custom_fields: { business_name: "Acme LLC", total_funding_estimate: 50000 } })]
  });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(db.messages[0].rendered_body, "Acme LLC owes 50000");
});

test("identity columns win over a stale same-named custom field", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "Hi {{contact.first_name}}")],
    clients: [client({ first_name: "Alice", custom_fields: { first_name: "STALE" } })]
  });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(db.messages[0].rendered_body, "Hi Alice");
});

test("contact.name / contact.full_name compose from the identity columns", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "{{contact.name}} | {{contact.full_name}}")], clients: [client()] });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(db.messages[0].rendered_body, "Alice Nguyen | Alice Nguyen");
});

test("an explicitly passed context still wins over the record, per key", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "{{contact.first_name}} / {{contact.last_name}}")],
    clients: [client()]
  });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", context: { contact: { first_name: "Override" } } });
  assert.equal(db.messages[0].rendered_body, "Override / Nguyen", "override wins, un-overridden keys survive");
});

test("a client row that cannot be loaded renders blank, it does not throw or leak braces", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey {{contact.first_name}}!")], clients: [] });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(res.sent, true);
  assert.equal(db.messages[0].rendered_body, "Hey !");
});

test("a send with no clientId still renders (no client lookup attempted)", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey {{contact.first_name}}!")], clients: [client()] });
  const res = await sendTemplated(db, { ...BASE, clientId: null, templateKey: "N-01-SMS" });
  assert.equal(res.sent, true);
  assert.equal(db.messages[0].rendered_body, "Hey !");
});

test("template_pending short-circuits before the client record is loaded", async () => {
  let loaded = false;
  const db = pgFake({ templates: [], clients: [client()] });
  const inner = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/FROM clients/.test(sql)) loaded = true;
    return inner(sql, params);
  };
  const res = await sendTemplated(db, { ...BASE, templateKey: "GHOST" });
  assert.equal(res.reason, "template_pending");
  assert.equal(loaded, false, "a no-op send must not cost a client query");
});

// =============================================================================
// STAFF TELEMETRY — the `text_sent` seam.
//
// It is EMPTY in production: all 39 call sites of this function are Inngest
// workflows with no staff member, and there is no staff-facing send endpoint in
// the product. These tests pin the seam's shape so the day one is built, the
// row is right — and, more importantly, pin that a workflow send writes NOTHING,
// which is the behaviour every existing caller depends on.
// =============================================================================

const SHIFT = "55555555-5555-4555-8555-555555555555";
const STAFF = "22222222-2222-4222-8222-222222222222";

test("a workflow send — no staffId — never even ATTEMPTS a staff_events write", async () => {
  // The whole of production, and asserted on the statement rather than on the
  // outcome. logStaffEvent() would refuse an absent staff id by itself, so a
  // test that only checks "no row landed" passes with the guard deleted — and
  // 39 workflows would each issue a doomed write and log a failure line per
  // send. What must be true is that the seam is not entered at all.
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")] });
  const { value: res, lines } = await quietly(() => sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" }));
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 1, "the message still queues");
  assert.equal(db.events.length, 0, "a workflow has nobody to attribute the send to");
  assert.ok(!db.sql.some((s) => /staff_events/.test(s)),
    "an unattributed telemetry write must not be attempted, not merely refused downstream");
  assert.ok(!db.sql.some((s) => /FROM shifts/.test(s)),
    "and it must not cost a shift lookup for a person who does not exist");
  // The guard's real teeth. Without it logStaffEvent still refuses the write —
  // and logs a skip line for it. Every outbound message in the product goes
  // through here, so that is a warning on every send, forever, about a person
  // who was never supposed to exist. Silence is the requirement.
  assert.deepEqual(lines, [], `a workflow send must be silent, got: ${JSON.stringify(lines)}`);
});

test("a staff-initiated sms writes one text_sent event on that person's shift", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")] });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", staffId: STAFF, shiftId: SHIFT });
  assert.equal(res.sent, true);
  assert.equal(db.events.length, 1);
  assert.equal(db.events[0].kind, "text_sent");
  assert.equal(db.events[0].staff_id, STAFF);
  assert.equal(db.events[0].shift_id, SHIFT);
  assert.equal(db.events[0].detail.template_key, "N-01-SMS");
  assert.equal(db.events[0].detail.client_id, "cl-1");
});

test("an email is not a text — no kind covers it, so none is written", async () => {
  const db = pgFake({ templates: [tpl("F-07-EMAIL", "Funded.")] });
  await sendTemplated(db, { ...BASE, channel: "email", templateKey: "F-07-EMAIL", staffId: STAFF, shiftId: SHIFT });
  assert.equal(db.messages.length, 1, "the email still queues");
  assert.equal(db.events.length, 0, "filing an email under text_sent would make the count a lie");
});

test("a suppressed send writes no event — nothing was sent", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "Hey!")],
    optOuts: [{ client_id: "cl-1", channel: "sms", opted_in_at: null }]
  });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", staffId: STAFF, shiftId: SHIFT });
  assert.equal(res.sent, false);
  assert.equal(db.events.length, 0);
});

test("a missing template writes no event — nothing was sent", async () => {
  const db = pgFake({ templates: [] });
  await sendTemplated(db, { ...BASE, templateKey: "GHOST", staffId: STAFF, shiftId: SHIFT });
  assert.equal(db.events.length, 0);
});

test("a replayed event queues nothing the second time and counts nothing the second time", async () => {
  // The dedupe index makes the second insert a no-op. Counting it anyway would
  // inflate one person's numbers every time a provider retried.
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")] });
  const args = { ...BASE, templateKey: "N-01-SMS", staffId: STAFF, shiftId: SHIFT };
  await sendTemplated(db, args);
  await sendTemplated(db, args);
  assert.equal(db.messages.length, 1, "the dedupe index is what stops the second queue");
  assert.equal(db.events.length, 1, "and the replay must not count as a second text");
});

test("with no shift named, the sender's open shift is looked up", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")], openShift: SHIFT });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", staffId: STAFF });
  assert.equal(db.events[0].shift_id, SHIFT);
});

test("sending off the clock is logged with a NULL shift, not refused", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")], openShift: null });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", staffId: STAFF });
  assert.equal(db.events.length, 1);
  assert.equal(db.events[0].shift_id, null);
});

test("a broken telemetry write does NOT fail the send it observes", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")], failOn: /INSERT INTO staff_events/ });
  const { value: res, lines } = await quietly(() =>
    sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", staffId: STAFF, shiftId: SHIFT })
  );
  assert.equal(res.sent, true, "telemetry took the send down with it");
  assert.equal(db.messages.length, 1, "the message is the record; it must survive a broken observer");
  assert.equal(db.events.length, 0);
  assert.ok(lines.some((l) => /\[telemetry\].*write_failed/.test(l)), JSON.stringify(lines));
});

test("the rendered body is never copied into the telemetry detail", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Your score is 512 and you were denied.")] });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", staffId: STAFF, shiftId: SHIFT });
  const detail = JSON.stringify(db.events[0].detail);
  assert.ok(!/512|denied/.test(detail), `client-facing copy leaked into telemetry: ${detail}`);
});

// =============================================================================
// ATTACHMENTS (B5 smash) — queue-time encode
//
// Empty [] still queues (non-pack mail). Pack "no PDF → no email" is U-02.
// Bad files must be dropped: no throw, no 0-byte pack.pdf, no path bombs.
// =============================================================================

const PDF_B64 = Buffer.from("%PDF-1.4\n% smash\n").toString("base64");
const emailTpl = (key, body = "Your file.") =>
  ({ org_id: "org-1", template_key: key, body, subject: "Docs", compliance_passed: true });
const EMAIL_BASE = { ...BASE, channel: "email", templateKey: "F-ATT-EMAIL" };

test("attachments: [] still queues — ordinary non-pack mail", async () => {
  const db = pgFake({ templates: [emailTpl("F-ATT-EMAIL")], clients: [client()] });
  const res = await sendTemplated(db, { ...EMAIL_BASE, attachments: [] });
  assert.equal(res.sent, true);
  assert.equal(res.attachmentCount, 0);
  assert.deepEqual(db.messages[0].attachments, []);
});

test("attachments: missing content is dropped — never a 0-byte pack.pdf", async () => {
  const db = pgFake({ templates: [emailTpl("F-ATT-EMAIL")], clients: [client()] });
  const res = await sendTemplated(db, {
    ...EMAIL_BASE,
    attachments: [
      { filename: "pack.pdf" },
      { filename: "pack.pdf", contentBase64: "" },
      { filename: "pack.pdf", content: null },
      { filename: "pack.pdf", contentBase64: "   " }
    ]
  });
  assert.equal(res.sent, true, "non-pack queue still succeeds with junk dropped");
  assert.equal(res.attachmentCount, 0);
  assert.deepEqual(db.messages[0].attachments, []);
  assert.ok(!JSON.stringify(db.messages[0].attachments).includes("pack.pdf"));
});

test("attachments: path traversal and huge names are sanitized", async () => {
  const db = pgFake({ templates: [emailTpl("F-ATT-EMAIL")], clients: [client()] });
  const huge = `${"A".repeat(500)}.pdf`;
  const res = await sendTemplated(db, {
    ...EMAIL_BASE,
    attachments: [
      { filename: "../../etc/passwd.pdf", contentBase64: PDF_B64 },
      { filename: huge, contentBase64: PDF_B64 }
    ]
  });
  assert.equal(res.sent, true);
  assert.equal(res.attachmentCount, 2);
  const names = db.messages[0].attachments.map((a) => a.filename);
  assert.ok(!names.some((n) => n.includes("..") || n.includes("/")), names);
  assert.equal(names[0], "passwd.pdf");
  assert.ok(names[1].length <= 180, names[1].length);
  assert.ok(names[1].endsWith(".pdf"));
});

test("attachments: non-PDF pretending to be pdf is dropped", async () => {
  const db = pgFake({ templates: [emailTpl("F-ATT-EMAIL")], clients: [client()] });
  const res = await sendTemplated(db, {
    ...EMAIL_BASE,
    attachments: [
      { filename: "pack.pdf", contentBase64: Buffer.from("not a pdf at all").toString("base64") },
      { filename: "real.pdf", contentBase64: PDF_B64 }
    ]
  });
  assert.equal(res.attachmentCount, 1);
  assert.equal(db.messages[0].attachments[0].filename, "real.pdf");
  assert.equal(db.messages[0].attachments[0].contentType, "application/pdf");
});

test("attachments: never throws on garbage list entries", async () => {
  const db = pgFake({ templates: [emailTpl("F-ATT-EMAIL")], clients: [client()] });
  const res = await sendTemplated(db, {
    ...EMAIL_BASE,
    attachments: [null, undefined, "string", 42, { filename: "x.pdf", contentBase64: PDF_B64 }]
  });
  assert.equal(res.sent, true);
  assert.equal(res.attachmentCount, 1);
});

// =============================================================================
// MESSAGING INBOX THREADING — upsertConversation + linkMessage after INSERT
//
// P6: workflow outbound used to leave conversation_id NULL, so Messaging inbox
// never listed packs that CCP already showed by client_id. Same seam as
// comms.mjs threadMessage / compose.mjs — swallow thread failures, never lose
// the queue row. Replay (DO NOTHING) must not emit a second thread write.
// =============================================================================

test("threading: queues a message AND sets conversation_id on a new (client, channel) thread", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")], clients: [client()] });
  const res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 1);
  assert.equal(db.conversations.length, 1);
  assert.equal(db.conversations[0].client_id, "cl-1");
  assert.equal(db.conversations[0].channel, "sms");
  assert.equal(db.messages[0].conversation_id, db.conversations[0].id);
});

test("threading: second send on the same channel reuses the one thread", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")], clients: [client()] });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", eventId: "evt-a" });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", eventId: "evt-b" });
  assert.equal(db.messages.length, 2);
  assert.equal(db.conversations.length, 1, "one (client, channel) thread only");
  assert.equal(db.messages[0].conversation_id, db.conversations[0].id);
  assert.equal(db.messages[1].conversation_id, db.conversations[0].id);
});

test("threading: email and sms are separate threads — channel is exact, no case fold", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "Hey!"), emailTpl("F-07-EMAIL", "Funded.")],
    clients: [client()]
  });
  await sendTemplated(db, { ...BASE, channel: "sms", templateKey: "N-01-SMS", eventId: "evt-sms" });
  await sendTemplated(db, { ...BASE, channel: "email", templateKey: "F-07-EMAIL", eventId: "evt-email" });
  assert.equal(db.conversations.length, 2);
  const channels = db.conversations.map((c) => c.channel).sort();
  assert.deepEqual(channels, ["email", "sms"]);
});

test("threading: DO NOTHING replay does not emit a second thread write", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")], clients: [client()] });
  const args = { ...BASE, templateKey: "N-01-SMS" };
  await sendTemplated(db, args);
  const upserts = db.sql.filter((s) => /INSERT INTO conversations/.test(s)).length;
  const links = db.sql.filter((s) => /UPDATE messages m[\s\S]*SET conversation_id/.test(s)).length;
  await sendTemplated(db, args);
  assert.equal(db.messages.length, 1);
  assert.equal(
    db.sql.filter((s) => /INSERT INTO conversations/.test(s)).length,
    upserts,
    "replay must not upsert again"
  );
  assert.equal(
    db.sql.filter((s) => /UPDATE messages m[\s\S]*SET conversation_id/.test(s)).length,
    links,
    "replay must not link again"
  );
});

test("threading: upsert/link throw still returns sent:true and keeps the queue row", async () => {
  const db = pgFake({
    templates: [tpl("N-01-SMS", "Hey!")],
    clients: [client()],
    failOn: /INSERT INTO conversations/
  });
  const realErr = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(" "));
  let res;
  try {
    res = await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS" });
  } finally {
    console.error = realErr;
  }
  assert.equal(res.sent, true, "thread failure must not fail the send");
  assert.equal(db.messages.length, 1, "queue row must survive");
  assert.equal(db.messages[0].conversation_id, null);
  assert.ok(lines.some((l) => /conversation threading failed/.test(l)), JSON.stringify(lines));
});

test("threading: no clientId skips thread write (message still queues)", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Hey!")] });
  const res = await sendTemplated(db, { ...BASE, clientId: null, templateKey: "N-01-SMS" });
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 1);
  assert.equal(db.conversations.length, 0);
  assert.ok(!db.sql.some((s) => /INSERT INTO conversations/.test(s)));
});

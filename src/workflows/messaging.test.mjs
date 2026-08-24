import { test } from "node:test";
import assert from "node:assert";
import { sendTemplated, formatAppointmentStart } from "./messaging.mjs";

// In-memory DB fake covering message_templates, messages, opt_outs, and the client
// record sendTemplated reads merge-tag context from.
function pgFake({ templates = [], optOuts = [], clients = [], openShift = null, failOn = null } = {}) {
  const messages = [];
  const events = [];          // staff_events, the telemetry seam's output
  const sql = [];             // every statement issued, so a test can assert one was NOT
  return {
    messages,
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
        messages.push({ org_id: params[0], client_id: params[1], channel: params[2], template_key: params[3], rendered_body: params[4], provider_ref: params[5] });
        return { rows: [{ id: "msg-" + messages.length }] };
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

test("formatAppointmentStart: ISO-Z becomes a human string, not raw ISO", () => {
  const iso = "2026-08-23T02:49:58.390Z";
  const human = formatAppointmentStart(iso, "America/Phoenix");
  assert.notEqual(human, iso);
  assert.doesNotMatch(human, /T\d{2}:\d{2}:\d{2}/);
  assert.match(human, /Aug/);
  assert.match(human, /7:49/);
});

test("sendTemplated: appointment.start_time ISO-Z renders as a human time", async () => {
  const iso = "2026-08-23T02:49:58.390Z";
  const db = pgFake({
    templates: [tpl("SMS-S04-01-CONFIRM", "booked for {{appointment.start_time}}")],
    clients: [{ id: "cl-1", first_name: "Chris", last_name: "S", email: "a@b.com", phone: "+15551234567", custom_fields: {} }]
  });
  await sendTemplated(db, {
    ...BASE,
    templateKey: "SMS-S04-01-CONFIRM",
    context: { appointment: { start_time: iso } }
  });
  const body = db.messages[0].rendered_body;
  assert.notEqual(body, `booked for ${iso}`);
  assert.doesNotMatch(body, /2026-08-23T02:49:58/);
  assert.match(body, /booked for /);
  assert.match(body, /Aug/);
});

test("the rendered body is never copied into the telemetry detail", async () => {
  const db = pgFake({ templates: [tpl("N-01-SMS", "Your score is 512 and you were denied.")] });
  await sendTemplated(db, { ...BASE, templateKey: "N-01-SMS", staffId: STAFF, shiftId: SHIFT });
  const detail = JSON.stringify(db.events[0].detail);
  assert.ok(!/512|denied/.test(detail), `client-facing copy leaked into telemetry: ${detail}`);
});

const CONFIRM_EMAIL_BODY = `<table>
  <tr>
    <td>When</td>
    <td>{{appointment.start_time}}</td>
  </tr>
  <tr>
    <td>Where</td>
    <td>{{appointment.meeting_location}}</td>
  </tr>
</table>`;

test("sendTemplated: confirm email omits a blank Where row", async () => {
  const db = pgFake({
    templates: [{
      org_id: "org-1",
      template_key: "EMAIL-S04-01-CONFIRM",
      channel: "email",
      subject: "You're booked",
      body: CONFIRM_EMAIL_BODY,
      compliance_passed: true
    }],
    clients: [{ id: "cl-1", first_name: "Chris", last_name: "S", email: "a@b.com", phone: "+15551234567", custom_fields: {} }]
  });
  await sendTemplated(db, {
    ...BASE,
    channel: "email",
    templateKey: "EMAIL-S04-01-CONFIRM",
    context: { appointment: { start_time: "2026-08-25T20:00:00Z", meeting_location: null } }
  });
  const body = db.messages[0].rendered_body;
  assert.match(body, /When/);
  assert.doesNotMatch(body, />\s*Where\s*</);
});

test("sendTemplated: confirm email keeps Where when a join URL is present", async () => {
  const db = pgFake({
    templates: [{
      org_id: "org-1",
      template_key: "EMAIL-S04-01-CONFIRM",
      channel: "email",
      subject: "You're booked",
      body: CONFIRM_EMAIL_BODY,
      compliance_passed: true
    }],
    clients: [{ id: "cl-1", first_name: "Chris", last_name: "S", email: "a@b.com", phone: "+15551234567", custom_fields: {} }]
  });
  await sendTemplated(db, {
    ...BASE,
    channel: "email",
    templateKey: "EMAIL-S04-01-CONFIRM",
    context: { appointment: { start_time: "2026-08-25T20:00:00Z", meeting_location: "https://meet.example.com/abc" } }
  });
  const body = db.messages[0].rendered_body;
  assert.match(body, />\s*Where\s*</);
  assert.match(body, /https:\/\/meet\.example\.com\/abc/);
});

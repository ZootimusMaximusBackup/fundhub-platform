import { test } from "node:test";
import assert from "node:assert";
import { sendTemplated } from "./messaging.mjs";

// In-memory DB fake covering message_templates, messages, opt_outs, and the client
// record sendTemplated reads merge-tag context from.
function pgFake({ templates = [], optOuts = [], clients = [] } = {}) {
  const messages = [];
  return {
    messages,
    optOuts,
    clients,
    async query(sql, params = []) {
      if (/SELECT first_name, last_name, email, phone, custom_fields FROM clients/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [c] : [] };
      }
      if (/SELECT body, subject FROM message_templates/.test(sql)) {
        const [orgId, key] = params;
        const t = templates.find((t) => t.org_id === orgId && t.template_key === key && t.compliance_passed);
        return { rows: t ? [{ body: t.body, subject: t.subject || null }] : [] };
      }
      if (/SELECT 1 FROM opt_outs/.test(sql)) {
        const r = optOuts.find((o) => o.client_id === params[0] && o.channel === params[1] && !o.opted_in_at);
        return { rows: r ? [{ 1: 1 }] : [] };
      }
      if (/INSERT INTO messages/.test(sql)) {
        messages.push({ org_id: params[0], client_id: params[1], channel: params[2], template_key: params[3], rendered_body: params[4], provider_ref: params[5] });
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
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

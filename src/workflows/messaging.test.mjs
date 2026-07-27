import { test } from "node:test";
import assert from "node:assert";
import { sendTemplated } from "./messaging.mjs";

// In-memory DB fake covering message_templates, messages, and opt_outs.
function pgFake({ templates = [], optOuts = [] } = {}) {
  const messages = [];
  return {
    messages,
    optOuts,
    async query(sql, params = []) {
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

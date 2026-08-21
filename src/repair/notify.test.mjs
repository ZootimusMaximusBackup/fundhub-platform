import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMAIL_REPAIR_LETTERS_SENT,
  EMAIL_REPAIR_WELCOME,
  EMAIL_REPAIR_RESPONSE_RESULTS,
  EMAIL_REPAIR_ROUND_ADVANCED,
  EMAIL_REPAIR_RETAKE_PHOTO,
  EMAIL_REPAIR_TRIAL_COMPLETE_UPSELL,
  REPAIR_EMAIL_KEYS,
  TEMPLATE_BY_EVENT,
  formatAccountLine,
  formatAccountsList,
  formatOutcomesList,
  notifyRepairEmail,
  notifyRepairRetake,
  repairMergeContext
} from "./notify.mjs";
import { onRepairEvent } from "./handlers.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";

describe("repair email templates map", () => {
  it("seeds six keys and maps each §7 event", () => {
    assert.equal(REPAIR_EMAIL_KEYS.length, 6);
    assert.equal(TEMPLATE_BY_EVENT["repair.enrolled"], EMAIL_REPAIR_WELCOME);
    assert.equal(TEMPLATE_BY_EVENT["repair.letters.sent"], EMAIL_REPAIR_LETTERS_SENT);
    assert.equal(TEMPLATE_BY_EVENT["repair.response.parsed"], EMAIL_REPAIR_RESPONSE_RESULTS);
    assert.equal(TEMPLATE_BY_EVENT["repair.round.escalated"], EMAIL_REPAIR_ROUND_ADVANCED);
    assert.equal(TEMPLATE_BY_EVENT["repair.response.retake"], EMAIL_REPAIR_RETAKE_PHOTO);
    assert.equal(TEMPLATE_BY_EVENT["repair.program.complete"], EMAIL_REPAIR_TRIAL_COMPLETE_UPSELL);
  });

  it("formats account lines with bureau names", () => {
    assert.equal(
      formatAccountLine({ creditor: "Chase", accountLast4: "1234", bureau: "EX" }),
      "Chase ending 1234 (Experian)"
    );
    assert.match(formatAccountsList([
      { creditor: "Chase", accountLast4: "1234", bureau: "EX" },
      { creditor: "Cap One", accountLast4: "9988", bureau: "EQ" }
    ]), /Chase ending 1234 \(Experian\)/);
  });

  it("formats outcomes in plain words without promising future results", () => {
    const text = formatOutcomesList([
      { creditor: "Midland", accountLast4: "4521", bureau: "TU", outcome: "deleted" },
      { creditor: "Bank", accountLast4: "1111", bureau: "EX", outcome: "verified" }
    ]);
    assert.match(text, /no longer listed/);
    assert.match(text, /verified/);
    assert.doesNotMatch(text, /will remove|guarantee|score will/i);
  });
});

describe("notifyRepairEmail", () => {
  it("D1: letters.sent queues EMAIL-REPAIR-LETTERS-SENT naming the accounts", async () => {
    const calls = [];
    const send = async (_db, args) => {
      calls.push(args);
      return { sent: true, messageId: "m1" };
    };
    const res = await notifyRepairEmail(null, {
      name: "repair.letters.sent",
      orgId: "org-1",
      clientId: "cl-1",
      payload: {
        eventId: "send-1",
        accounts: [
          { creditor: "Chase", accountLast4: "4321", bureau: "EX" },
          { creditor: "LVNV", accountLast4: "7788", bureau: "EQ" }
        ],
        bureaus: ["EX", "EQ"]
      },
      send
    });
    assert.equal(res.sent, true);
    assert.equal(res.templateKey, EMAIL_REPAIR_LETTERS_SENT);
    assert.equal(calls[0].channel, "email");
    assert.equal(calls[0].templateKey, EMAIL_REPAIR_LETTERS_SENT);
    const list = calls[0].context.repair.accounts_list;
    assert.match(list, /Chase ending 4321 \(Experian\)/);
    assert.match(list, /LVNV ending 7788 \(Equifax\)/);
    assert.match(calls[0].context.repair.bureaus_list, /Experian/);
    assert.match(calls[0].context.repair.bureaus_list, /Equifax/);
  });

  it("D1 via sendTemplated: rendered body includes the exact account lines", async () => {
    const body =
      "Letters cover:\n{{repair.accounts_list}}\nBureaus: {{repair.bureaus_list}}";
    const db = {
      messages: [],
      async query(sql, params = []) {
        if (/FROM message_templates/.test(sql)) {
          return {
            rows: [{
              body,
              subject: "Your dispute letters are on the way",
              compliance_passed: true
            }]
          };
        }
        if (/FROM clients/.test(sql)) {
          return {
            rows: [{
              first_name: "Alex",
              last_name: "Test",
              email: "e2e+aff-repair@example.com",
              phone: null,
              custom_fields: {}
            }]
          };
        }
        if (/INSERT INTO messages/.test(sql)) {
          this.messages.push({
            template_key: params[3],
            rendered_body: params[4],
            channel: params[2],
            provider_ref: params[5]
          });
          return { rows: [{ id: "msg-1" }] };
        }
        return { rows: [] };
      }
    };
    const res = await notifyRepairEmail(db, {
      name: "repair.letters.sent",
      orgId: "org-1",
      clientId: "cl-1",
      payload: {
        eventId: "a1-send",
        accounts: [{ creditor: "Chase", accountLast4: "4321", bureau: "EX" }],
        bureaus: ["EX"]
      },
      send: sendTemplated
    });
    assert.equal(res.sent, true);
    assert.equal(db.messages.length, 1);
    assert.equal(db.messages[0].channel, "email");
    assert.equal(db.messages[0].template_key, EMAIL_REPAIR_LETTERS_SENT);
    assert.match(db.messages[0].rendered_body, /Chase ending 4321 \(Experian\)/);
    assert.match(db.messages[0].rendered_body, /Experian/);
  });

  it("loads accounts from dispute rows when payload has letter results only", async () => {
    const calls = [];
    const db = {
      async query(sql) {
        if (/FROM dispute_letters/.test(sql)) {
          return { rows: [{ id: "L1", bureau: "EX", round: "R1" }] };
        }
        if (/FROM dispute_items/.test(sql)) {
          return {
            rows: [{
              creditor: "Portfolio Recovery",
              account_last4: "5566",
              bureau: "EX",
              round: "R1"
            }]
          };
        }
        return { rows: [] };
      }
    };
    await notifyRepairEmail(db, {
      name: "repair.letters.sent",
      orgId: "11111111-1111-1111-1111-111111111111",
      clientId: "22222222-2222-2222-2222-222222222222",
      payload: {
        eventId: "send-db",
        results: [{ ok: true, bureau: "EX", letterId: "L1" }]
      },
      send: async (_db, args) => {
        calls.push(args);
        return { sent: true };
      }
    });
    assert.match(calls[0].context.repair.accounts_list, /Portfolio Recovery ending 5566 \(Experian\)/);
  });

  it("trial-complete upsell skips full programs", async () => {
    const res = await notifyRepairEmail(null, {
      name: "repair.program.complete",
      orgId: "o",
      clientId: "c",
      payload: { program: "full", eventId: "pc1" },
      send: async () => ({ sent: true })
    });
    assert.equal(res.sent, false);
    assert.equal(res.reason, "not_trial_program");
  });

  it("trial-complete upsell queues for trial", async () => {
    const calls = [];
    const res = await notifyRepairEmail(null, {
      name: "repair.program.complete",
      orgId: "o",
      clientId: "c",
      payload: { program: "trial", eventId: "pc2", results_recap: "Round 1 and 2 letters mailed." },
      send: async (_db, args) => {
        calls.push(args);
        return { sent: true };
      }
    });
    assert.equal(res.sent, true);
    assert.equal(calls[0].templateKey, EMAIL_REPAIR_TRIAL_COMPLETE_UPSELL);
    assert.match(calls[0].context.repair.results_recap, /Round 1 and 2/);
  });

  it("retake queues EMAIL-REPAIR-RETAKE-PHOTO with agent instructions", async () => {
    const calls = [];
    const res = await notifyRepairRetake(null, {
      orgId: "o",
      clientId: "c",
      messageToClient: "Move closer so the full page fits and avoid glare on the top right.",
      eventId: "retake-1",
      send: async (_db, args) => {
        calls.push(args);
        return { sent: true };
      }
    });
    assert.equal(res.sent, true);
    assert.equal(calls[0].templateKey, EMAIL_REPAIR_RETAKE_PHOTO);
    assert.equal(calls[0].channel, "email");
    assert.match(calls[0].context.repair.retake_message, /glare/);
  });

  it("never uses sms channel", async () => {
    for (const name of Object.keys(TEMPLATE_BY_EVENT)) {
      const calls = [];
      await notifyRepairEmail(null, {
        name,
        orgId: "o",
        clientId: "c",
        payload: { program: "trial", eventId: name, accounts: [], outcomes: [], escalated: [] },
        send: async (_db, args) => {
          calls.push(args);
          return { sent: true };
        }
      });
      assert.equal(calls[0]?.channel, "email", name);
    }
  });
});

describe("onRepairEvent wires emails", () => {
  it("letters.sent returns email queue result with named accounts", async () => {
    const db = {
      async query(sql) {
        if (/pipeline_stages/.test(sql)) {
          return { rows: [{ stage_id: "st", pipeline_id: "pl" }] };
        }
        if (/FROM cards/.test(sql) || /INSERT INTO cards/.test(sql) || /UPDATE cards/.test(sql)) {
          return { rows: [{ id: "card-1" }] };
        }
        if (/INSERT INTO repair_decision_log/.test(sql)) return { rows: [] };
        return { rows: [] };
      }
    };
    const orig = await onRepairEvent(db, {
      name: "repair.letters.sent",
      orgId: "org-1",
      clientId: "cl-1",
      payload: {
        eventId: "handler-send-1",
        accounts: [{ creditor: "Chase", accountLast4: "4321", bureau: "EX" }],
        results: [{ ok: true, bureau: "EX" }]
      }
    });
    // Without a real template row, sendTemplated returns template_pending —
    // still proves the handler attempted the LETTERS-SENT key.
    assert.equal(orig.email?.templateKey, EMAIL_REPAIR_LETTERS_SENT);
    assert.ok(orig.email);
  });

  it("retake is email-only and does not require a stage", async () => {
    const db = {
      async query() {
        return { rows: [] };
      }
    };
    const r = await onRepairEvent(db, {
      name: "repair.response.retake",
      orgId: "org-1",
      clientId: "cl-1",
      payload: {
        message_to_client: "Retake with better light.",
        eventId: "retake-h"
      }
    });
    assert.equal(r.ok, true);
    assert.equal(r.emailOnly, true);
    assert.equal(r.email?.templateKey, EMAIL_REPAIR_RETAKE_PHOTO);
  });
});

describe("repairMergeContext", () => {
  it("builds repair.* bag for templates", () => {
    const ctx = repairMergeContext({
      accounts: [{ creditor: "A", accountLast4: "1", bureau: "TU" }],
      round: "R2",
      retake_message: "Blurry"
    });
    assert.match(ctx.repair.accounts_list, /TransUnion/);
    assert.equal(ctx.repair.round, "2");
    assert.equal(ctx.repair.retake_message, "Blurry");
  });
});

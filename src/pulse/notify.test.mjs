import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHRIS_PROVE_SMS,
  DARWIN_WHATSAPP_ENV,
  darwinWhatsAppNumber,
  formatChrisSms,
  formatDarwinTicket,
  textChris,
  ticketDarwin
} from "./notify.mjs";

test("Chris SMS is the prove number and names no credit outcome", () => {
  const body = formatChrisSms({
    date: "2026-08-25",
    pass: 4,
    fail: 1,
    skip: 1,
    topFails: ["gate-relay: no heartbeat.json"]
  });
  assert.match(body, /2026-08-25/);
  assert.match(body, /4 passed/);
  assert.match(body, /1 failed/);
  assert.match(body, /gate-relay/);
  assert.match(body, /did not change any product code/);
  assert.doesNotMatch(body, /approved|score|FICO|credit/i);
  assert.equal(CHRIS_PROVE_SMS, "+16616054248");
});

test("Darwin WhatsApp is skipped until DARWIN_WHATSAPP is set — no number is invented", async () => {
  assert.equal(darwinWhatsAppNumber({}), null);
  assert.equal(darwinWhatsAppNumber({ [DARWIN_WHATSAPP_ENV]: "   " }), null);
  const calls = [];
  const out = await ticketDarwin({
    date: "2026-08-25",
    findings: ["health: down"],
    suggestedFixes: ["Read /api/health?strict=1"],
    env: {},
    dryRun: false,
    sendImpl: async (msg) => {
      calls.push(msg);
      return { status: "sent" };
    }
  });
  assert.equal(out.sent, false);
  assert.match(out.reason, /DARWIN_WHATSAPP unset/);
  assert.equal(out.to, null);
  assert.equal(calls.length, 0);
  assert.match(out.ticket, /Audit only/);
  assert.match(out.ticket, /health: down/);
});

test("dry-run never sends Chris or Darwin", async () => {
  const boom = async () => {
    throw new Error("send must not run in dry-run");
  };
  const sms = await textChris({
    date: "2026-08-25",
    pass: 1,
    fail: 0,
    env: { [DARWIN_WHATSAPP_ENV]: "+15555550100" },
    dryRun: true,
    sendImpl: boom
  });
  const darwin = await ticketDarwin({
    date: "2026-08-25",
    findings: [],
    env: { [DARWIN_WHATSAPP_ENV]: "+15555550100" },
    dryRun: true,
    sendImpl: boom
  });
  assert.equal(sms.sent, false);
  assert.equal(sms.reason, "dry_run");
  assert.equal(sms.to, CHRIS_PROVE_SMS);
  assert.equal(darwin.sent, false);
  assert.equal(darwin.reason, "dry_run");
  assert.equal(darwin.to, "+15555550100");
});

test("Darwin ticket lists FAIL rows and suggested fixes", () => {
  const ticket = formatDarwinTicket({
    date: "2026-08-25",
    findings: ["login: 500"],
    suggestedFixes: ["Restore /login.html"]
  });
  assert.match(ticket, /Fundhub pulse ticket 2026-08-25/);
  assert.match(ticket, /1\. login: 500/);
  assert.match(ticket, /1\. Restore \/login.html/);
  assert.match(ticket, /No auto-fix/);
});

// Daily pulse notices — one SMS to Chris, one Darwin ticket hook.
//
// COMPLIANCE REVIEW REQUIRED: this is an ops text, not a client message.
// No credit-outcome claims. No auto-fix.
//
// Chris: dest from PULSE_SMS_TO (or CHRIS_PULSE_SMS). Do not hardcode.
// Darwin: WhatsApp only when DARWIN_WHATSAPP is set. Do not invent a number.

import { send as sendSms } from "../messaging/providers/twilio.mjs";
import { send as sendWhatsApp } from "../messaging/providers/twilio-whatsapp.mjs";

export const PULSE_SMS_TO_ENV = "PULSE_SMS_TO";
export const CHRIS_PULSE_SMS_ENV = "CHRIS_PULSE_SMS";
export const DARWIN_WHATSAPP_ENV = "DARWIN_WHATSAPP";

export function chrisPulseSmsTo(env = process.env) {
  const raw = String(
    (env && (env[PULSE_SMS_TO_ENV] || env[CHRIS_PULSE_SMS_ENV])) || ""
  ).trim();
  return raw || null;
}

export function darwinWhatsAppNumber(env = process.env) {
  const raw = String((env && env[DARWIN_WHATSAPP_ENV]) || "").trim();
  return raw || null;
}

export function formatChrisSms({ date, pass = 0, fail = 0, skip = 0, topFails = [] } = {}) {
  const day = String(date || "").trim() || "today";
  const first = Array.isArray(topFails) ? topFails.filter(Boolean).slice(0, 2) : [];
  const failLine = first.length
    ? ` Failed: ${first.join("; ")}.`
    : "";
  return (
    `Fundhub morning check ${day}: ${pass} passed, ${fail} failed, ${skip} skipped.` +
    failLine +
    " Suggested fixes are on the pulse board. I did not change any product code."
  );
}

export function formatDarwinTicket({ date, findings = [], suggestedFixes = [] } = {}) {
  const day = String(date || "").trim() || "today";
  const fails = Array.isArray(findings) ? findings.filter(Boolean) : [];
  const fixes = Array.isArray(suggestedFixes) ? suggestedFixes.filter(Boolean) : [];
  const failLines = fails.length
    ? fails.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "No FAIL rows.";
  const fixLines = fixes.length
    ? fixes.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "None.";
  return [
    `Fundhub pulse ticket ${day}`,
    "Audit only. No auto-fix.",
    "",
    "FAIL list:",
    failLines,
    "",
    "Suggested fixes:",
    fixLines
  ].join("\n");
}

export async function textChris({
  date,
  pass,
  fail,
  skip,
  topFails,
  env = process.env,
  dryRun = true,
  sendImpl = sendSms
} = {}) {
  const body = formatChrisSms({ date, pass, fail, skip, topFails });
  const to = chrisPulseSmsTo(env);
  if (!to) {
    return { sent: false, reason: `${PULSE_SMS_TO_ENV} unset`, body, to: null };
  }
  if (dryRun) return { sent: false, reason: "dry_run", body, to };
  const result = await sendImpl(
    { to, body, channel: "sms" },
    { env }
  );
  return { sent: result?.status === "sent", reason: result?.error || null, body, to, result };
}

export async function ticketDarwin({
  date,
  findings,
  suggestedFixes,
  env = process.env,
  dryRun = true,
  sendImpl = sendWhatsApp
} = {}) {
  const ticket = formatDarwinTicket({ date, findings, suggestedFixes });
  const to = darwinWhatsAppNumber(env);
  if (!to) {
    return {
      ticket,
      sent: false,
      reason: `${DARWIN_WHATSAPP_ENV} unset`,
      to: null
    };
  }
  if (dryRun) return { ticket, sent: false, reason: "dry_run", to };
  const result = await sendImpl(
    { to, body: ticket, channel: "whatsapp" },
    { env }
  );
  return { ticket, sent: result?.status === "sent", reason: result?.error || null, to, result };
}

// Blake referral mail → name + phone for a staff text to Chris.
// Chris texts the person himself. Never text the referred person from here.
//
// From-address was read from prove Gmail on 2026-08-28 (Blake Evertsen,
// info@evertsenequity.com). Chris said "Edwardson" — both last names match.
// Do not invent a third inbox.

import { normalizePhone } from "../messaging/providers/bland-voice.mjs";
import { formatRepPhone } from "../messaging/unsubscribe.mjs";

export const BLAKE_FROM_EMAIL = "info@evertsenequity.com";
export const BLAKE_SENDER_NAMES = Object.freeze([
  "blake evertsen",
  "blake edwardson"
]);
export const PROCESSED_LABEL = "fundhub-blake-lead";
/** Send only recent mail. Older matches get labeled so a first deploy does not dump the week. */
export const SEND_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const BLAKE_GMAIL_QUERY =
  `(from:${BLAKE_FROM_EMAIL} OR from:"Blake Evertsen" OR from:"Blake Edwardson" OR (subject:Fwd AND (info@evertsenequity.com OR "Blake Evertsen" OR "Blake Edwardson"))) newer_than:3d -label:${PROCESSED_LABEL}`;

const PHONE_RE = /(?:\+?1[-.\s]*)?(?:\(?\d{3}\)?[-.\s]*)\d{3}[-.\s]*\d{4}/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const SIGNATURE_CUT =
  /Blake Evertsen|Blake Edwardson|Founder\s*&\s*CEO|reach me by text/i;

function clean(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function extraFromEmails(env = {}) {
  const raw = String((env && env.BLAKE_FROM_EMAIL) || "").trim();
  if (!raw) return [];
  return raw.split(/[,;\s]+/).map((s) => s.toLowerCase()).filter(Boolean);
}

export function parseFromHeader(raw) {
  const s = String(raw || "");
  const angle = s.match(/<([^>]+)>/);
  const email = String(angle ? angle[1] : (s.match(/[^\s<>]+@[^\s<>]+/) || [])[0] || "")
    .trim()
    .toLowerCase();
  const display = clean(s.replace(/<[^>]+>/g, "").replace(/"/g, ""));
  return { email, display };
}

export function isBlakeName(raw) {
  const s = clean(raw).toLowerCase();
  if (!s) return false;
  if (BLAKE_SENDER_NAMES.includes(s)) return true;
  return /^blake\s+(evertsen|edwardson)\b/.test(s);
}

export function isInvitationSubject(subject) {
  return /^\s*invitation\b/i.test(String(subject || ""));
}

function bodyLooksForwardedFromBlake(body) {
  const text = String(body || "");
  if (!/^\s*(fwd?|fw)\s*:/im.test(text) && !/forwarded message/i.test(text) && !/^From:/m.test(text)) {
    return /From:\s*.*Blake\s+(Evertsen|Edwardson)/i.test(text)
      || new RegExp(`From:\\s*.*${BLAKE_FROM_EMAIL}`, "i").test(text);
  }
  return /Blake\s+(Evertsen|Edwardson)/i.test(text)
    || text.toLowerCase().includes(BLAKE_FROM_EMAIL);
}

export function isBlakeMail({ from, subject, body, env } = {}) {
  const parsed = parseFromHeader(from);
  if (parsed.email === BLAKE_FROM_EMAIL) return true;
  if (extraFromEmails(env).includes(parsed.email)) return true;
  if (isBlakeName(parsed.display)) return true;
  if (/^\s*(fwd?|fw)\s*:/i.test(String(subject || "")) && bodyLooksForwardedFromBlake(body)) {
    return true;
  }
  return bodyLooksForwardedFromBlake(body);
}

function nameFromSubject(subject) {
  let s = String(subject || "").trim();
  if (!s || isInvitationSubject(s)) return "";
  s = s.replace(/^\s*(fwd?|fw)\s*:\s*/i, "");
  s = s.replace(/\s*[-–—]\s*\[[^\]]*\]\s*booking link.*$/i, "");
  s = s.replace(/\s*[-–—]\s*booking link.*$/i, "");
  s = s.replace(/🛠️/g, "").trim();
  if (!s || isBlakeName(s)) return "";
  if (/credit repair|\brepair\b/i.test(s)) return "";
  return s;
}

function extractPhones(text) {
  const hits = String(text || "").match(PHONE_RE) || [];
  const out = [];
  const seen = new Set();
  for (const raw of hits) {
    const e164 = normalizePhone(raw);
    if (!e164 || seen.has(e164)) continue;
    seen.add(e164);
    out.push(e164);
  }
  return out;
}

function looksLikeName(line) {
  const s = clean(line);
  if (!s || s.length > 80) return false;
  if (EMAIL_RE.test(s)) return false;
  if (extractPhones(s).length) return false;
  if (isBlakeName(s)) return false;
  if (/credit repair|\brepair\b/i.test(s)) return false;
  return /^[A-Za-z][A-Za-z.'’-]+(?:\s+[A-Za-z][A-Za-z.'’-]+){0,4}$/.test(s);
}

function clientInfoBlock(body) {
  const m = String(body || "").match(/\*{0,2}CLIENT INFO\*{0,2}\s*([\s\S]{0,500})/i);
  return m ? m[1] : "";
}

function bodyBeforeSignature(body) {
  const text = String(body || "");
  const cut = text.search(SIGNATURE_CUT);
  return cut >= 0 ? text.slice(0, cut) : text;
}

function leadFromClientInfo(block) {
  const lines = String(block || "").split(/\r?\n/).map((l) => l.replace(/\*+/g, "").trim()).filter(Boolean);
  let name = "";
  let phone = "";
  for (const line of lines) {
    if (!name && looksLikeName(line)) name = clean(line);
    if (!phone) {
      const phones = extractPhones(line);
      if (phones[0]) phone = phones[0];
    }
    if (name && phone) break;
    if (EMAIL_RE.test(line) && name) break;
  }
  return { name, phone };
}

export function parseReferredLead({ subject, body, from } = {}) {
  if (isInvitationSubject(subject)) return null;
  const info = leadFromClientInfo(clientInfoBlock(body));
  const name = info.name || nameFromSubject(subject);
  const preSig = bodyBeforeSignature(body);
  const phone = info.phone || extractPhones(clientInfoBlock(body))[0] || extractPhones(preSig)[0] || "";
  if (!name || !phone) return null;
  if (isBlakeName(name)) return null;
  const sender = parseFromHeader(from);
  if (sender.display && clean(name).toLowerCase() === clean(sender.display).toLowerCase()) {
    return null;
  }
  return { name, phone };
}

export function formatChrisLeadSms({ name, phone } = {}) {
  const who = clean(name);
  const num = formatRepPhone(phone) || clean(phone);
  return ["New referral", who, num].filter(Boolean).join("\n");
}

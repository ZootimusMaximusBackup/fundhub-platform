// Deterministic dispute letter body from a violation list.
// NEVER invents violations. No ruleId → no claim.
// Prose variance comes from seeded openings/closings/ordering — not from inventing facts.

import { citationsFor, metro2RefFor } from "../rules/citations.mjs";
import { openingFor, closingFor, roundInstructions, rotateViolations, ROUND } from "./prompts.mjs";
import { formatComplaintFilings } from "../rounds/complaint-filing.mjs";
import { resolvedCitationBlock } from "./citations-assert.mjs";
import { generateWithVarianceGate, structuralFingerprint } from "./variance.mjs";
import { handwrittenSignOff } from "./sign-block.mjs";

function bureauName(code) {
  return ({ EX: "Experian", EQ: "Equifax", TU: "TransUnion" })[String(code || "").toUpperCase()] || String(code || "Credit Bureau");
}

function hashSeed(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const RULE_PLAIN_NAMES = Object.freeze({
  "M2-005": "Stale Date of Account Information",
  "M2-007": "Obsolete item",
  "M2-011": "Status-balance contradiction",
  "M2-031": "Stale former address",
  "M2-036": "Duplicate same-day inquiry"
});

/**
 * The prompt bank's Round 1 / Round 3 / furnisher lines name Metro 2 outright.
 * A letter whose every claim is a derogatory-item claim (../diy/derogatory.mjs)
 * asserts no Metro 2 defect, so saying so would be a false statement in a mailed
 * letter — and a false statement is exactly what a furnisher uses to call the
 * dispute frivolous. These are the accurate substitutes, applied ONLY when no
 * M2- rule is present. A mixed letter keeps the original wording, because then
 * the Metro 2 claim really is there.
 */
const WITHOUT_METRO2 = Object.freeze({
  "I dispute the Metro 2 field defects identified below and ask you to delete or correct them.":
    "I dispute the items identified below and ask you to delete or correct them.",
  "This Round 3 letter is the last bureau notice on these Metro 2 defects. It is not a lawsuit.":
    "This Round 3 letter is the last bureau notice on these items. It is not a lawsuit.",
  "Please investigate the Metro 2 defects below on accounts you furnish.":
    "Please investigate the items below on accounts you furnish.",
  "The items below have Metro 2 reporting defects that make my file inaccurate or misleading.":
    "The items below are reported inaccurately or in a way that makes my file misleading."
});

/** Does this letter carry at least one Metro 2 rule finding? */
export function hasMetro2Claim(violations) {
  return (violations || []).some((v) => /^M2-/.test(String(v?.ruleId || "")));
}

function accurate(line, metro2Backed) {
  if (metro2Backed) return line;
  return WITHOUT_METRO2[line] || line;
}

const SEVERITY_LABEL = Object.freeze({
  deletion: "Deletion-tier",
  strong: "Strong",
  moderate: "Moderate",
  supporting: "Supporting"
});

function lastFourSsn(identity) {
  if (!identity || identity.ssn == null || identity.ssn === "") return null;
  const digits = String(identity.ssn).replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

function plainName(v) {
  if (RULE_PLAIN_NAMES[v.ruleId]) return RULE_PLAIN_NAMES[v.ruleId];
  /* A claim may carry its own name. The derogatory-item claims in
     ../diy/derogatory.mjs do, because they are not Metro 2 rules and there is
     no exhibit reference to fall back on. */
  if (v.plainName) return String(v.plainName).trim();
  const metro = v.metro2Ref || metro2RefFor(v.ruleId);
  if (metro) return String(metro).trim();
  const reason = String(v.reason || "").trim();
  if (reason) return reason.split(/[.;]/)[0].trim().slice(0, 80);
  return v.ruleId;
}

function fieldLine(v) {
  const metro = v.metro2Ref || metro2RefFor(v.ruleId);
  if (metro) return `Metro 2 field: ${metro}`;
  if (v.field != null && String(v.field).trim() !== "") {
    const f = String(v.field).trim();
    return `Metro 2 field: ${/^field\b/i.test(f) ? f : `Field ${f}`}`;
  }
  /* No field and no exhibit reference. A derogatory-item claim asserts no Metro 2
     defect, so naming a field would be the invention this whole module refuses.
     The line is dropped instead — formatViolationParagraph filters nulls. */
  return null;
}

function capItemStatutes(v) {
  const cites = v.citations || citationsFor(v.ruleId) || [];
  const bits = Array.isArray(cites)
    ? [...cites]
    : [...(cites.statutes || []), ...(cites.cases || cites.caseLaw || [])];
  const isCase = (s) => /\bv\.\s/i.test(String(s));
  const statutes = bits.filter((s) => !isCase(s)).map((s) => String(s));
  const cases = bits.filter(isCase).map((s) => String(s));
  const out = statutes.slice(0, 3);
  if (out.length < 2 && cases[0]) out.push(cases[0]);
  return out.slice(0, 3);
}

function accountLine(v) {
  const who = String(v?.creditor || "").trim();
  const last4 = String(v?.account_last4 || v?.accountLast4 || "").replace(/\D/g, "").slice(-4);
  if (!who && !last4) return null;
  if (who && last4) return `Account: ${who} · ending ${last4}`;
  if (who) return `Account: ${who}`;
  return `Account ending ${last4}`;
}

function formatViolationParagraph(v) {
  if (!v?.ruleId) return null;
  const observed = v.observed == null ? "not populated as required" : JSON.stringify(v.observed);
  const expected = v.expected == null ? "compliant Metro 2 reporting" : JSON.stringify(v.expected);
  const statutes = capItemStatutes(v);
  const sev = SEVERITY_LABEL[v.severity] || "Supporting";
  return [
    `Violation ${v.ruleId} — ${plainName(v)}`,
    fieldLine(v),
    `Severity: ${sev}`,
    accountLine(v),
    v.reason || "Reporting defect identified by deterministic Metro 2 check.",
    `Observed: ${observed}. Expected: ${expected}.`,
    statutes.length ? `Legal basis: ${statutes.join("; ").replace(/\.$/, "")}.` : null
  ].filter(Boolean).join("\n");
}

/**
 * Prior bureau answers become evidence in R2+ letters (spec §5.5 / B3).
 */
export function formatPriorEvidence(priorResponses = []) {
  const lines = [];
  for (const pr of priorResponses || []) {
    if (!pr) continue;
    const dateRaw = pr.date || pr.respondedAt || pr.created_at || null;
    const date = dateRaw ? String(dateRaw).slice(0, 10) : "an earlier date";
    const outcome = String(pr.outcome || "verified").toLowerCase();
    const last4 = String(pr.accountLast4 || pr.account_last4 || "xxxx").replace(/\D/g, "").slice(-4) || "xxxx";
    const excerpt = String(pr.rawExcerpt || pr.raw_text || "").trim().replace(/\s+/g, " ").slice(0, 200);
    let line = `On ${date} you responded '${outcome}' for account ending ${last4}`;
    if (excerpt && excerpt.toLowerCase() !== outcome) {
      line += `: "${excerpt}"`;
    }
    lines.push(`${line}.`);
  }
  return lines;
}

/**
 * Build letter plain text.
 * @param {{
 *   violations: object[],
 *   identity: { fullName, addressLine1, addressLine2?, city, state, zip, ssn?, accountLast4? },
 *   bureau: 'EX'|'EQ'|'TU',
 *   round?: string,
 *   seed?: string|number,
 *   undated?: boolean,
 *   date?: string|null,
 *   priorResponses?: object[],
 *   priorFilings?: object[]
 * }} opts
 */
export function buildLetterText(opts = {}) {
  const violations = (opts.violations || []).filter((v) => v && v.ruleId);
  if (violations.length === 0) {
    throw new Error("no_rule_id_claims — refuse to generate a letter with zero rule-backed violations");
  }
  const identity = opts.identity || {};
  const bureau = String(opts.bureau || "").toUpperCase();
  const round = opts.round || ROUND.R1;
  const instr = roundInstructions(round);
  const seed = hashSeed(opts.seed ?? `${identity.fullName || ""}:${bureau}:${round}`);
  const ordered = rotateViolations(violations, seed + (opts.attempt || 0) * 7);
  const attempt = Number(opts.attempt) || 0;
  const metro2Backed = hasMetro2Claim(violations);
  /* WHY THE BUREAU IS SPREAD ACROSS THE POOL BY HAND, AND NOT LEFT TO THE SEED.
   *
   * The variance gate strips every itemised claim block before it compares two
   * letters (proseForVariance), so what it actually compares is the header, the
   * opening, the lead and the closing. Two bureau letters that draw the SAME
   * opening and closing are then ~91% identical and the gate refuses the batch —
   * correctly, that is its job.
   *
   * The bureau is already in the seed, so the draw was meant to differ. It did
   * not reliably, for two reasons. The pools hold six lines each and
   * `closingFor(seed + 3)` moves in lockstep with `openingFor(seed)`, so two
   * bureaus whose seeds are congruent mod 6 collide on BOTH lines at once — a
   * one-in-six pair collision, not one in thirty-six, and with three bureaus
   * drawing that is a coin flip on every batch.
   *
   * It bit hardest on the letters added 2026-09-03 for the owner rule "any
   * derogatory deserves a letter" — measured, a repair client with a collection
   * and a charge-off got ONE letter and two `variance_gate_exhausted` refusals —
   * but nothing about it was specific to those. A three-bureau Metro 2 batch was
   * always the same coin flip, absorbed by the regeneration strikes.
   *
   * So the spread is made deterministic instead of hoped for. Offsets 0 / 2 / 4
   * over a six-line pool put the three bureaus on three different openings on
   * every attempt, and the closing is mixed differently so it does not track the
   * opening. NO NEW COPY IS INTRODUCED: every line drawn is one of the six
   * already written and already in use for that round. Only which of them a
   * given bureau draws has changed. */
  const bureauSpread = { TU: 0, EX: 2, EQ: 4 }[bureau] ?? 0;
  const open = accurate(openingFor(seed + attempt + bureauSpread, round), metro2Backed);
  const lead = accurate(instr.lead, metro2Backed);
  const close = closingFor(seed + attempt * 5 + 3 + bureauSpread * 2, round);
  const dateLine = opts.undated ? "[DATE — write today's date when you mail this]" : (opts.date || "");
  const name = identity.fullName || "[Consumer Name]";
  const addr = [
    identity.addressLine1,
    identity.addressLine2,
    [identity.city, identity.state, identity.zip].filter(Boolean).join(", ")
  ].filter(Boolean);
  const ssn4 = lastFourSsn(identity);

  const paragraphs = ordered.map((v) => formatViolationParagraph(v)).filter(Boolean);
  const evidenceLines = formatPriorEvidence(opts.priorResponses);
  // ── COMPLAINTS ALREADY FILED — read from the record, never assumed ──
  //
  // COMPLIANCE REVIEW REQUIRED — dispute logic.
  //
  // Fundhub mails the Round 4 CFPB complaint and the Round 5 state attorney
  // general complaint, so Round 6 may say they were filed. It may say it ONLY
  // from `priorFilings`, which the caller loads from dispute_letters rows that
  // are already status 'sent' or 'delivered' (../rounds/complaint-filing.mjs
  // loadComplaintFilings). No row, no sentence.
  //
  // Gated to R6 because R6 is the only rung that stands on the complaints. And
  // gated on the lines being non-empty, so a client whose complaints were never
  // mailed — or whose state attorney general has no postal address on file, which
  // today is every client — gets exactly the letter they got before this existed.
  const filingLines = String(round).toUpperCase() === ROUND.R6
    ? formatComplaintFilings(opts.priorFilings)
    : [];
  const evidenceBlock = (evidenceLines.length || filingLines.length)
    ? [
      ...(evidenceLines.length ? ["PRIOR BUREAU RESPONSE (evidence):", ...evidenceLines] : []),
      ...(evidenceLines.length && filingLines.length ? [""] : []),
      ...(filingLines.length ? ["COMPLAINTS ALREADY FILED (evidence):", ...filingLines] : [])
    ].join("\n")
    : null;
  const citationBlock = resolvedCitationBlock(ordered);
  const ruleIdList = ordered.map((v) => v.ruleId).join(", ");
  /* The subject line is the first thing read. It says Metro 2 only when a Metro 2
     claim is actually in the letter; otherwise it says what the letter is — an
     FCRA dispute. */
  const kind = metro2Backed ? "Metro 2" : "FCRA";
  const reSubject = String(round).toUpperCase() === ROUND.FURNISHER
    ? `Furnisher ${kind} dispute`
    : `Round ${instr.roundLabel || String(instr.round).replace(/^R/, "")} ${kind} dispute`;

  const headerLines = [
    dateLine,
    "",
    name,
    ...addr
  ];
  if (ssn4) headerLines.push(`Last four of SSN: ${ssn4}`);
  headerLines.push("", bureauName(bureau), "", `Re: ${reSubject} — ${ruleIdList}`);
  const header = headerLines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");

  const withEvidence = (parts) => {
    if (!evidenceBlock) return parts;
    const out = [];
    let inserted = false;
    for (const part of parts) {
      out.push(part);
      if (!inserted && (part === open || part === lead)) {
        out.push("");
        out.push(evidenceBlock);
        inserted = true;
      }
    }
    if (!inserted) out.push("", evidenceBlock);
    return out;
  };

  let body;
  if (attempt % 3 === 1) {
    body = withEvidence([open, "", lead, "", instr.demand, "", ...paragraphs.flatMap((p) => [p, ""]), instr.ask]).join("\n");
  } else if (attempt % 3 === 2) {
    body = withEvidence([
      lead,
      "",
      instr.demand,
      "",
      open,
      "",
      instr.ask,
      "",
      ...paragraphs.flatMap((p) => [p, ""]),
      "",
      instr.next
    ]).join("\n");
  } else {
    body = withEvidence([
      open,
      "",
      instr.demand,
      "",
      ...paragraphs.flatMap((p) => [p, ""]),
      "",
      lead,
      "",
      instr.next
    ]).join("\n");
  }

  return [
    header,
    "",
    body.trim(),
    "",
    "CITATIONS:",
    citationBlock,
    "",
    "CLOSING:",
    close,
    "",
    handwrittenSignOff(name)
  ].join("\n");
}

/**
 * Generate a letter that passes the variance gate against prior letters.
 */
export async function generateLetter(opts = {}) {
  const prior = opts.priorLetters || [];
  const result = await generateWithVarianceGate({
    priorLetters: prior,
    threshold: opts.threshold,
    produce: async (attempt) =>
      buildLetterText({ ...opts, attempt: attempt + (Number(opts.attemptOffset) || 0) })
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      attempts: result.attempts,
      stalled: true
    };
  }
  return {
    ok: true,
    text: result.text,
    fingerprint: result.fingerprint,
    attempts: result.attempts,
    bureau: opts.bureau,
    round: opts.round || ROUND.R1,
    ruleIds: (opts.violations || []).filter((v) => v?.ruleId).map((v) => v.ruleId),
    undated: !!opts.undated
  };
}

export { ROUND, structuralFingerprint };

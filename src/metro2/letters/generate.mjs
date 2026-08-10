// Deterministic dispute letter body from a violation list.
// NEVER invents violations. No ruleId → no claim.
// Prose variance comes from seeded openings/closings/ordering — not from inventing facts.

import { citationsFor, metro2RefFor } from "../rules/citations.mjs";
import { openingFor, closingFor, roundInstructions, rotateViolations, ROUND } from "./prompts.mjs";
import { resolvedCitationBlock } from "./citations-assert.mjs";
import { generateWithVarianceGate, structuralFingerprint } from "./variance.mjs";

function bureauName(code) {
  return ({ EX: "Experian", EQ: "Equifax", TU: "TransUnion" })[String(code || "").toUpperCase()] || String(code || "Credit Bureau");
}

function hashSeed(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function formatViolationParagraph(v, index) {
  if (!v?.ruleId) return null;
  const cites = v.citations || citationsFor(v.ruleId);
  const statuteBits = Array.isArray(cites)
    ? cites
    : [...(cites.statutes || []), ...(cites.cases || cites.caseLaw || [])];
  const metro = v.metro2Ref || metro2RefFor(v.ruleId);
  const field = v.field != null ? `Field ${v.field}` : "the reported fields";
  const observed = v.observed == null ? "not populated as required" : JSON.stringify(v.observed);
  const expected = v.expected == null ? "compliant Metro 2 reporting" : JSON.stringify(v.expected);
  return [
    `Item ${index + 1} (${v.ruleId}).`,
    v.reason || "Reporting defect identified by deterministic Metro 2 check.",
    `${field}: observed ${observed}; expected ${expected}.`,
    metro ? `Metro 2 reference: ${metro}.` : null,
    statuteBits.length ? `Legal basis: ${statuteBits.join("; ")}.` : null
  ].filter(Boolean).join(" ");
}

/**
 * Build letter plain text.
 * @param {{
 *   violations: object[],
 *   identity: { fullName, addressLine1, addressLine2?, city, state, zip, accountLast4? },
 *   bureau: 'EX'|'EQ'|'TU',
 *   round?: string,
 *   seed?: string|number,
 *   undated?: boolean,
 *   date?: string|null
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
  // Vary structure: attempt 0 body-first, attempt 1 lead-then-items, attempt 2 items then statutes emphasis
  const attempt = Number(opts.attempt) || 0;
  const open = openingFor(seed + attempt);
  const close = closingFor(seed + attempt + 3);
  const dateLine = opts.undated ? "[DATE — write today's date when you mail this]" : (opts.date || "");
  const name = identity.fullName || "[Consumer Name]";
  const addr = [
    identity.addressLine1,
    identity.addressLine2,
    [identity.city, identity.state, identity.zip].filter(Boolean).join(", ")
  ].filter(Boolean);

  const paragraphs = ordered.map((v, i) => formatViolationParagraph(v, i)).filter(Boolean);
  const citationBlock = resolvedCitationBlock(ordered);

  const header = [
    dateLine,
    "",
    name,
    ...addr,
    "",
    bureauName(bureau),
    "",
    `Re: Dispute of inaccurate credit reporting — Round ${instr.round}`
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");

  let body;
  if (attempt % 3 === 1) {
    body = [open, "", instr.lead, "", ...paragraphs.flatMap((p) => [p, ""])].join("\n");
  } else if (attempt % 3 === 2) {
    body = [
      instr.lead,
      "",
      `Hooks for this round: ${instr.hooks.join(", ")}.`,
      "",
      open,
      "",
      "Requested actions: delete or correct each item below after a reasonable investigation.",
      "",
      ...paragraphs.flatMap((p) => [p, ""])
    ].join("\n");
  } else {
    body = [
      open,
      "",
      `Tone: ${instr.tone}.`,
      "",
      ...paragraphs.flatMap((p) => [p, ""]),
      "",
      instr.lead
    ].join("\n");
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
    "Sincerely,",
    name
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

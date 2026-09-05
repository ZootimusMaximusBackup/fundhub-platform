// The client-facing progress timeline, and the one thing it may never say.
//
// ═══════════════════════════════════════════════════════════════════════════
// R4 AND R5 MUST NEVER APPEAR AS FILED
//
// src/metro2/letters/catalog.mjs:57-65 states it outright: the CFPB complaint
// and the state attorney general complaint SHIP to the client undated and
// unsigned, behind a cover sheet. The client fills in the date, hand-signs the
// perjury declaration and files them personally. "No table, column, endpoint or
// workflow in this repository ever hears whether that happened."
//
// So a line reading "CFPB complaint filed" would be this system asserting, on a
// screen the client reads, a fact it does not have and cannot get. That is the
// identical defect already fixed once on main, where the Round 3 letter told the
// bureau a CFPB complaint was being filed and no such document had ever been
// produced. It is not being recreated on the progress page.
//
// The timeline may say a complaint letter was PRODUCED. It may not say one was
// FILED, SUBMITTED, LODGED or SENT. deFileClaim() below rewrites any line that
// does, and progress-timeline.test.mjs fails if it stops.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHERE THE WORDS COME FROM
//
// repair_decision_log, via TIMELINE_SQL and timelineLine()
// (src/repair/lens.mjs:206) — both already written, both working, both
// staff-only until now. gatherRepairDetailSignals() is the function that pairs
// them and it is called rather than re-implemented.
//
// timelineLine() turns a decision like `letters.mailed` into "Mar 3 · letters
// mailed". It is a de-underscoring of a stored machine name, which means the
// words on a client's screen are chosen by whoever wrote the decision string,
// not by anyone editing copy. That is worth knowing and it is why the guard
// below operates on the RENDERED line and not on a list of known decisions: a
// decision nobody has written yet cannot be on a list.

import { gatherRepairDetailSignals } from "../repair/read-repair-signals.mjs";

/* A claim that a regulator complaint was actually filed.
   Two halves, both required: something that names the regulator, and a verb of
   submission. "cfpb complaint prepared" survives. "cfpb complaint filed" does
   not. */
const REGULATOR_RE = /\b(cfpb|consumer financial protection|attorney general|state ag|\bag complaint)\b/i;
const FILED_VERB_RE = /\b(filed|filing|submitted|submission|lodged|reported to|sent to)\b/i;

/** The replacement. Says the true thing: the document exists and it is theirs. */
export const PREPARED_LINE = "escalation complaint prepared for you to file";

/**
 * Rewrite any line claiming a regulator complaint was filed.
 * Returns the line unchanged when it makes no such claim.
 */
export function deFileClaim(text) {
  const s = String(text == null ? "" : text);
  if (!REGULATOR_RE.test(s) || !FILED_VERB_RE.test(s)) return s;
  // Keep the date prefix timelineLine() put on the front — it is a real fact
  // about when the letter was produced — and replace only the claim after it.
  const m = s.match(/^(.*?·\s*)/);
  return (m ? m[1] : "") + PREPARED_LINE;
}

/** True when a line asserts a regulator complaint was filed. The test's oracle. */
export function claimsFiled(text) {
  const s = String(text == null ? "" : text);
  return REGULATOR_RE.test(s) && FILED_VERB_RE.test(s);
}

/**
 * The timeline for one client, newest first, in the contract's shape.
 *
 * FAILS SOFT. gatherRepairDetailSignals() returns `{}` when the decision log
 * cannot be read, and this returns `[]` for that. An empty timeline is a screen
 * with one section missing; a throw is a screen with nothing on it.
 */
export async function progressTimeline(db, { orgId, clientId } = {}) {
  if (!db || !orgId || !clientId) return [];
  let signals = {};
  try {
    signals = await gatherRepairDetailSignals(db, { orgId, clientId }) || {};
  } catch (err) {
    console.warn("[progress] timeline read failed:", err && err.message);
    return [];
  }
  const rows = Array.isArray(signals.timeline) ? signals.timeline : [];
  return rows.map((row) => ({
    at: isoOrNull(row.ts),
    text: deFileClaim(row.words)
  }));
}

function isoOrNull(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

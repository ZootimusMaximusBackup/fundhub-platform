// ═══════════════════════════════════════════════════════════════════════════════
// THE MISSING WIRE — recorded bureau answer → UnderwriteIQ round gate
//
// COMPLIANCE REVIEW REQUIRED — dispute logic.
//
// WHAT WAS BROKEN
//
// The UnderwriteIQ letter pack could only ever write a Round 1 dispute letter.
// Its round gate is one field on each tradeline, `priorOutcome`, read in
// vendor/underwriteiq-full/api/lite/letter-generator.js `getAccountsForRound`:
//
//   round 1 → tradelines whose priorOutcome is empty / "pending" / "round1"
//   round 2 → tradelines whose priorOutcome is exactly "verified"
//   round 3 → tradelines whose priorOutcome is exactly "verified_round2"
//
// `src/underwrite/letter-pack.mjs` copied that field off the scoring engine's
// tradelines (`priorOutcome: t.priorOutcome || null`) and nothing in this
// repository ever put a value there. So it was always null, round 2 and round 3
// always matched zero accounts, and the escalation ladder's upper rungs — the
// CFPB and state Attorney General complaints, which ship behind a cover sheet
// reading "DO NOT FILE WITH ROUND 1 — send only after Round 3 is done" — could
// not be reached in normal use.
//
// WHAT ALREADY EXISTED (nothing here is a new capture path)
//
// A bureau's answer IS already captured, parsed, human-confirmed and stored:
//
//   api/repair/inbound-mail.mjs  → src/repair/parse-loop.mjs runParseAdvanceLoop
//   api/repair/exceptions.mjs    → src/repair/parse-loop.mjs confirmHeldParse
//     → src/metro2/inbound/parse-response.mjs   reads the scanned response text
//     → src/metro2/inbound/confirm.mjs          confirmParse — the human gate
//     → src/metro2/rounds/advance.mjs           advanceAfterParse
//     → src/metro2/rounds/state.mjs             applyItemOutcome
//     → src/repair/parse-loop.mjs               persistAdvancedItems (the write)
//
// `persistAdvancedItems` writes `dispute_items.status`, `.round` and `.outcome`.
// `applyItemOutcome` is the only thing that moves an item up a round, and it
// only does so on the outcome "verified": the item's status becomes "escalated"
// and its round becomes the NEXT round. Every other answer (deleted, updated,
// unaddressed) ends the item, and an item that runs into the program's round cap
// becomes "closed" with blocked_at_cap, not "escalated".
//
// So `dispute_items` already holds the recorded, confirmed answer. This module
// is the one wire from that record to the letter pack's gate. It reads. It never
// writes, never parses, never decides an outcome.
//
// THE GATE — read this before changing anything below
//
// A round may only advance on an answer a human confirmed. Never on a default,
// never on a guess, never on silence. Concretely, an item is only counted when
// ALL THREE of these are true in the database:
//
//   status  = 'escalated'   only applyItemOutcome sets this, only on "verified"
//   outcome = 'verified'    the recorded answer itself
//   round   = R2..R6        the round the item was moved UP to
//
// An item that was never answered is 'open' or 'sent' and is not counted. An
// item that hit the program cap is 'closed' and is not counted. An item still at
// R1 yields no prior outcome and keeps the Round 1 letter it already gets today.
//
// AND the account has to be the same account. A wrong match would hand a client
// a Round 2 letter for an account no bureau has answered on, which is the exact
// accident this file must not cause. So matching is deliberately strict:
// same bureau, then the last four digits of the account number. Creditor name
// alone is only accepted when the stored item carries no account number AND
// exactly one tradeline at that bureau bears that name — one ambiguous name
// match stamps nothing.
// ═══════════════════════════════════════════════════════════════════════════════

import { promptPoolRound, ROUND } from "../metro2/letters/prompts.mjs";

/** dispute_cases.bureau code → the scoring engine's tradeline `source` key. */
const BUREAU_KEY = Object.freeze({
  EX: "experian",
  TU: "transunion",
  EQ: "equifax"
});

/**
 * The vendor letter generator's round vocabulary. These two strings are not
 * ours to rename — `getAccountsForRound` compares against them literally.
 */
export const PRIOR_OUTCOME = Object.freeze({
  /** Verified once. Unlocks the Round 2 method-of-verification letter. */
  ROUND_2: "verified",
  /** Verified twice. Unlocks the Round 3 final-notice letter. */
  ROUND_3: "verified_round2"
});

/** Later beats earlier when one account carries more than one recorded answer. */
const RANK = Object.freeze({
  [PRIOR_OUTCOME.ROUND_2]: 1,
  [PRIOR_OUTCOME.ROUND_3]: 2
});

/** Only an escalated item with a recorded "verified" answer advances. */
const ADVANCED_STATUS = "escalated";
const ADVANCING_OUTCOME = "verified";

function digitsLast4(value) {
  const d = String(value ?? "").replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : "";
}

function nameNorm(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Which of the pack's three letters an item sitting at `round` has earned.
 *
 * The pack knows three rounds; the repair desk runs six. `promptPoolRound`
 * (src/metro2/letters/prompts.mjs) is this repository's existing answer to
 * "which of the three letter shapes does round N use" — R4 and R6 reuse R2,
 * R5 reuses R3 — and it is reused here rather than a second rule being written.
 *
 * @returns {string|null} a PRIOR_OUTCOME value, or null for R1 / FURNISHER /
 *   anything unrecognised. Null means "no advance", which leaves today's
 *   Round 1 behaviour exactly as it is.
 */
export function priorOutcomeForRound(round) {
  const pool = promptPoolRound(String(round || "").toUpperCase());
  if (pool === ROUND.R2) return PRIOR_OUTCOME.ROUND_2;
  if (pool === ROUND.R3) return PRIOR_OUTCOME.ROUND_3;
  return null;
}

/**
 * Read the confirmed bureau answers already on file for one client.
 *
 * Read-only. Filtered in SQL on the three conditions in the header, so a row
 * that comes back is by construction an item a human confirmed as verified and
 * that the round machine moved up.
 *
 * A failure here must not cost the client their letters, so it is reported as a
 * `skip` string rather than thrown — the same shape the letter pack already uses
 * for `deliverableSkip` and `summarySkip`.
 *
 * @returns {Promise<{ outcomes: object[], skip: string|null }>}
 */
export async function loadPriorOutcomes(db, { clientId } = {}) {
  if (!db || typeof db.query !== "function") return { outcomes: [], skip: "no_db" };
  if (!clientId) return { outcomes: [], skip: "no_client" };
  try {
    const r = await db.query(
      `SELECT dc.bureau, di.creditor, di.account_last4, di.round
         FROM dispute_items di
         JOIN dispute_cases dc ON dc.id = di.case_id
        WHERE di.client_id = $1
          AND di.status = $2
          AND di.outcome = $3`,
      [clientId, ADVANCED_STATUS, ADVANCING_OUTCOME]
    );
    return { outcomes: r?.rows || [], skip: null };
  } catch (err) {
    return { outcomes: [], skip: String(err && err.message || err).slice(0, 240) };
  }
}

/** Tradelines at one bureau that are the account this recorded item names. */
function matchTradelines(tradelines, row) {
  const last4 = digitsLast4(row.account_last4);
  if (last4) {
    return tradelines.filter(
      (t) => digitsLast4(t.accountIdentifier || t.accountId || t.accountNumber) === last4
    );
  }
  // No account number on the record. A creditor name is only enough when it
  // picks out exactly one account — two cards from the same bank must not both
  // be escalated off one answer.
  const name = nameNorm(row.creditor);
  if (!name) return [];
  const named = tradelines.filter(
    (t) => nameNorm(t.creditorName || t.creditor) === name
  );
  return named.length === 1 ? named : [];
}

/**
 * Stamp `priorOutcome` onto the tradelines the recorded answers name.
 *
 * Mutates the `bureaus` map produced by `bureausFromEngine` in place — that map
 * is built fresh for every pack, so there is nothing shared to corrupt.
 *
 * @param {object} bureaus  { experian, transunion, equifax } → { tradelines: [] }
 * @param {object[]} outcomes rows from loadPriorOutcomes
 * @returns {{ stamped: number, unmatched: number }} counts, for reporting
 */
export function stampPriorOutcomes(bureaus, outcomes = []) {
  let stamped = 0;
  let unmatched = 0;
  if (!bureaus || typeof bureaus !== "object") return { stamped, unmatched };
  for (const row of outcomes || []) {
    const key = BUREAU_KEY[String(row?.bureau || "").trim().toUpperCase()];
    const file = key ? bureaus[key] : null;
    const tradelines = Array.isArray(file?.tradelines) ? file.tradelines : null;
    const earned = priorOutcomeForRound(row?.round);
    if (!tradelines || !earned) {
      unmatched += 1;
      continue;
    }
    const hits = matchTradelines(tradelines, row);
    if (!hits.length) {
      unmatched += 1;
      continue;
    }
    for (const t of hits) {
      // Two recorded answers on one account means it was verified twice. Keep
      // the further one — never step an account back down a round.
      const held = RANK[t.priorOutcome] || 0;
      if (RANK[earned] > held) {
        t.priorOutcome = earned;
        stamped += 1;
      }
    }
  }
  return { stamped, unmatched };
}

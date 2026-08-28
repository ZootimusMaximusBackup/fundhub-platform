// Attack plan for the Specialist repair desk.
// Copy comes only from metro2 catalog + prompt pools + round cap.
// Does not invent a legal strategy.

import { roundLadderEntry } from "../metro2/letters/catalog.mjs";
import { promptPoolRound } from "../metro2/letters/prompts.mjs";
import { BUREAU_ROUNDS, nextRound, roundAllowed } from "../metro2/rounds/state.mjs";

function roundNum(round) {
  const m = /^R(\d+)$/i.exec(String(round || ""));
  return m ? Number(m[1]) : null;
}

function latestWrittenRound(letters = []) {
  let best = null;
  let bestN = 0;
  for (const letter of letters) {
    const r = String(letter?.round || "").toUpperCase();
    const n = roundNum(r);
    if (n != null && n > bestN) {
      bestN = n;
      best = r;
    }
  }
  return best;
}

function attackLine(item) {
  const creditor = String(item?.creditor || "").trim();
  const last4 = String(item?.account_last4 || item?.accountLast4 || "").replace(/\D/g, "").slice(-4);
  const bureau = String(item?.bureau || "").toUpperCase();
  const rule = String(item?.rule_id || item?.ruleId || "").trim();
  const bits = [];
  if (bureau) bits.push(bureau);
  if (creditor) bits.push(creditor);
  if (last4) bits.push(`ending ${last4}`);
  if (rule) bits.push(rule);
  return bits.join(" · ");
}

/**
 * Six bureau rounds with held / blocked / written state.
 *
 * COMPLIANCE REVIEW REQUIRED — dispute logic.
 *
 * The rung's title and timing come from the round ladder
 * (src/metro2/letters/catalog.mjs `roundLadderEntry`): R1–R3 the bureau letters,
 * R4 the CFPB complaint, R5 the state attorney general complaint, R6 the final
 * notice reissued. This used to read `promptPoolRound` instead, which answers
 * only "which prose shape", so the plan showed R4 and R6 as a repeat of Round 2
 * and R5 as a repeat of Round 3 — the complaints never appeared in it at all.
 *
 * `pool` is still reported alongside, because it is still true and a caller may
 * want it: it is the bureau wording a letter for that round would use, and after
 * Round 3 that is always the R3 final-notice wording.
 */
export function buildRoundPlan({
  roundsCap = 6,
  items = [],
  letters = []
} = {}) {
  const cap = Math.min(Math.max(Number(roundsCap) || 6, 1), BUREAU_ROUNDS.length);
  const letterRounds = new Set(
    (letters || []).map((l) => String(l.round || "").toUpperCase()).filter((r) => /^R\d+$/.test(r))
  );
  const latest = latestWrittenRound(letters);
  const heldRound = latest ? nextRound(latest, cap) : null;

  return BUREAU_ROUNDS.map((round) => {
    const pool = promptPoolRound(round);
    const rung = roundLadderEntry(round);
    const attacks = (items || [])
      .filter((it) => String(it.round || "").toUpperCase() === round)
      .map((it) => attackLine(it))
      .filter(Boolean);

    let status = "later";
    if (!roundAllowed(round, cap)) status = "blocked_at_cap";
    else if (letterRounds.has(round)) status = "written";
    else if (heldRound && round === heldRound) status = "held";
    else if (!latest && round === "R1") status = "current";

    return {
      round,
      title: rung.title,
      when: rung.sendWhen,
      letterType: rung.type,
      pool,
      status,
      attacks
    };
  });
}

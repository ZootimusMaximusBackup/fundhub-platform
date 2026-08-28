// Attack plan for the Specialist repair desk.
// Copy comes only from metro2 catalog + prompt pools + round cap.
// Does not invent a legal strategy.

import { LETTER_META, LETTER_TYPES } from "../metro2/letters/catalog.mjs";
import { promptPoolRound, ROUND } from "../metro2/letters/prompts.mjs";
import { BUREAU_ROUNDS, nextRound, roundAllowed } from "../metro2/rounds/state.mjs";

const POOL_TO_TYPE = Object.freeze({
  [ROUND.R1]: LETTER_TYPES.R1_METRO2,
  [ROUND.R2]: LETTER_TYPES.R2_FCRA_MOV,
  [ROUND.R3]: LETTER_TYPES.R3_FINAL_NOTICE
});

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
 * R4–R6 reuse R2/R3 letter pools (src/metro2/letters/prompts.mjs).
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
    const meta = LETTER_META[POOL_TO_TYPE[pool] || LETTER_TYPES.R1_METRO2];
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
      title: meta.title,
      when: meta.sendWhen,
      pool,
      status,
      attacks
    };
  });
}

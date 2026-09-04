// Mechanical letter variance — Jaccard on 5-gram shingles.
// Spec: METRO2-DISPUTE-ENGINE-SPEC §5.2 and DIY-PACKAGE-SPEC §5.2.
// No override. Two regeneration strikes, then fail.

const DEFAULT_THRESHOLD = 0.35;
const MAX_STRIKES = 2;

/* Every rule id a claim block can be headed with.
 *
 * M2-### is a Metro 2 reporting defect. DEROG-* is a derogatory-item claim, added
 * 2026-09-03 for the owner rule "any derogatory deserves a letter, but only for
 * clients on the repair path" (src/metro2/diy/derogatory.mjs). Both render through
 * the same writer as `Violation <ruleId> — <plain name>`, so both are item blocks
 * and both belong in the strip list below.
 *
 * THIS PATTERN MISSING DEROG- IS WHY THE OWNER RULE ONLY HALF WORKED. A repair
 * client with a collection and a charge-off is supposed to get three letters, one
 * per bureau. They got ONE: the first bureau was written and the other two came
 * back `variance_gate_exhausted`. The same account is disputed at all three
 * bureaus in the same words — which is correct, it is the same account — and with
 * the claim blocks left in the comparison the three letters fingerprinted at
 * 0.975 similarity against a 0.35 threshold. The gate refused the product it was
 * meant to protect.
 *
 * Nothing is loosened by fixing it. The threshold is untouched, and everything the
 * gate compared before, it still compares — see
 * src/metro2/letters/variance-derogatory.test.mjs, which pins the three-bureau
 * case AND pins that two genuinely identical letters are still refused.
 *
 * PI-* joined the list on 2026-09-03 for exactly the same reason, one step
 * worse. It is the personal-information floor (src/metro2/diy/personal-info-floor.mjs),
 * which every repair-path client gets on every bureau — and the floor's claims
 * are the SAME words at all three bureaus by definition, because it is the same
 * name and the same address. Left out of this list, a clean file would have
 * produced one letter and two `variance_gate_exhausted` refusals, which is the
 * empty desk the floor exists to end. Nothing is loosened: the threshold is
 * untouched and every comparison the gate made before, it still makes. */
const CLAIM_RULE_ID =
  String.raw`(?:M2-\d{3}|DEROG-[A-Z0-9]+(?:-[A-Z0-9]+)*|PI-[A-Z0-9]+(?:-[A-Z0-9]+)*)`;

/** Strip fixed citation/legal/item blocks before fingerprinting — facts stay fixed; prose varies. */
export function proseForVariance(letterText) {
  return String(letterText || "")
    .replace(/CITATIONS:[\s\S]*?(?=\nCLOSING:|\nSincerely|\nRespectfully|$)/i, " ")
    .replace(
      new RegExp(
        `Violation ${CLAIM_RULE_ID}[\\s\\S]*?(?=\\n\\nViolation ${CLAIM_RULE_ID}|\\n\\nCITATIONS:|\\n\\nCLOSING:|$)`,
        "gi"
      ), " ")
    .replace(
      new RegExp(
        `Item \\d+ \\(${CLAIM_RULE_ID}\\)[\\s\\S]*?(?=\\n\\nItem \\d+|\\n\\nTone:|\\n\\nHooks:|\\n\\nRequested|\\n\\nCITATIONS:|\\n\\nCLOSING:|$)`,
        "gi"
      ), " ")
    .replace(/^Metro 2 field:.*$/gim, " ")
    .replace(/^Severity:.*$/gim, " ")
    .replace(/\bM2-\d{3}\b/g, " ")
    .replace(/\bDEROG-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g, " ")
    .replace(/\bPI-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g, " ")
    .replace(/15 U\.S\.C\.[^\n.]*/g, " ")
    .replace(/§\s*1681[^\n.]*/g, " ")
    .replace(/Field \d+:[\s\S]*?(?=\n|$)/g, " ")
    .replace(/Signature: _+/g, " ")
    .replace(/^Date: _+$/gim, " ");
}

/** Normalize for fingerprinting: lowercase, collapse whitespace, strip punctuation noise. */
export function normalizeForShingles(text) {
  return proseForVariance(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Character 5-grams over normalized text. */
export function structuralFingerprint(letterText) {
  const s = normalizeForShingles(letterText);
  const set = new Set();
  if (s.length < 5) {
    if (s) set.add(s);
    return set;
  }
  for (let i = 0; i <= s.length - 5; i++) set.add(s.slice(i, i + 5));
  return set;
}

/** Jaccard similarity of two shingle sets. 0 = disjoint, 1 = identical. */
export function similarityScore(a, b) {
  const A = a instanceof Set ? a : structuralFingerprint(a);
  const B = b instanceof Set ? b : structuralFingerprint(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Compare a new letter against prior letters to the same bureau.
 * @returns {{ ok: true, score: number } | { ok: false, score: number, threshold: number, againstIndex: number }}
 */
export function assertBelowThreshold(newLetter, priorLetters = [], threshold = DEFAULT_THRESHOLD) {
  const fp = typeof newLetter === "string" ? structuralFingerprint(newLetter) : newLetter;
  let worst = 0;
  let worstIdx = -1;
  for (let i = 0; i < priorLetters.length; i++) {
    const score = similarityScore(fp, priorLetters[i]);
    if (score > worst) {
      worst = score;
      worstIdx = i;
    }
    if (score > threshold) {
      return { ok: false, score, threshold, againstIndex: i };
    }
  }
  return { ok: true, score: worst, againstIndex: worstIdx };
}

/**
 * Pairwise within a batch + optional rolling window of prior client letters.
 * Any pair above threshold → fail naming the later index.
 */
export function assertBatchVariance(letters, threshold = DEFAULT_THRESHOLD, priorByBureau = {}) {
  const fps = letters.map((L) => {
    const text = typeof L === "string" ? L : L.text || L.body || "";
    const bureau = typeof L === "object" ? L.bureau : null;
    return { fp: structuralFingerprint(text), bureau, text };
  });
  for (let i = 0; i < fps.length; i++) {
    for (let j = 0; j < i; j++) {
      const score = similarityScore(fps[i].fp, fps[j].fp);
      if (score > threshold) {
        return { ok: false, score, threshold, a: j, b: i, reason: "intra_batch" };
      }
    }
    const bureau = fps[i].bureau;
    if (bureau && priorByBureau[bureau]) {
      const gate = assertBelowThreshold(fps[i].fp, priorByBureau[bureau], threshold);
      if (!gate.ok) {
        return { ok: false, score: gate.score, threshold, a: gate.againstIndex, b: i, reason: "prior_window", bureau };
      }
    }
  }
  return { ok: true };
}

/**
 * Regenerate loop: call `produce()` up to MAX_STRIKES+1 times until variance passes.
 * @returns {{ ok: true, text, fingerprint, attempts } | { ok: false, reason, attempts, last }}
 */
export async function generateWithVarianceGate({
  produce,
  priorLetters = [],
  threshold = DEFAULT_THRESHOLD,
  maxStrikes = MAX_STRIKES
}) {
  let last = null;
  const attempts = maxStrikes + 1;
  for (let i = 0; i < attempts; i++) {
    const text = await produce(i);
    last = text;
    const gate = assertBelowThreshold(text, priorLetters, threshold);
    if (gate.ok) {
      return {
        ok: true,
        text,
        fingerprint: [...structuralFingerprint(text)],
        attempts: i + 1,
        score: gate.score
      };
    }
  }
  return { ok: false, reason: "variance_gate_exhausted", attempts, last, threshold };
}

export { DEFAULT_THRESHOLD, MAX_STRIKES };

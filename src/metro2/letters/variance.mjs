// Mechanical letter variance — Jaccard on 5-gram shingles.
// Spec: METRO2-DISPUTE-ENGINE-SPEC §5.2 and DIY-PACKAGE-SPEC §5.2.
// No override. Two regeneration strikes, then fail.

const DEFAULT_THRESHOLD = 0.35;
const MAX_STRIKES = 2;

/** Strip fixed citation/legal/item blocks before fingerprinting — facts stay fixed; prose varies. */
export function proseForVariance(letterText) {
  return String(letterText || "")
    .replace(/CITATIONS:[\s\S]*?(?=\nCLOSING:|\nSincerely|\nRespectfully|$)/i, " ")
    .replace(/Item \d+ \(M2-\d{3}\)[\s\S]*?(?=\n\nItem \d+|\n\nTone:|\n\nHooks:|\n\nRequested|\n\nCITATIONS:|\n\nCLOSING:|$)/gi, " ")
    .replace(/\bM2-\d{3}\b/g, " ")
    .replace(/15 U\.S\.C\.[^\n.]*/g, " ")
    .replace(/§\s*1681[^\n.]*/g, " ")
    .replace(/Field \d+:[\s\S]*?(?=\n|$)/g, " ");
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

// Parse bureau/furnisher response text into per-item outcomes + confidence.
// AI may be plugged later; heuristic baseline is deterministic and testable.

const OUTCOMES = Object.freeze(["deleted", "verified", "updated", "unaddressed"]);

/**
 * @param {{ text: string, items: { id: string, creditor?: string, account_last4?: string }[] }} input
 * @returns {{ outcomes: { itemId, outcome, evidence }[], confidence: number, needsConfirm: boolean }}
 */
export function parseResponseText({ text, items = [] }) {
  const raw = String(text || "");
  const lower = raw.toLowerCase();
  const outcomes = [];
  let hits = 0;

  for (const it of items) {
    const last4 = it.account_last4 ? String(it.account_last4) : null;
    const creditor = it.creditor ? String(it.creditor).toLowerCase() : null;
    const window = excerptAround(lower, last4, creditor);
    let outcome = "unaddressed";
    let evidence = null;
    if (/deleted|removed|has been deleted|no longer report/.test(window)) {
      outcome = "deleted";
      evidence = "deleted_language";
      hits++;
    } else if (/verified|remains|accurate|has been verified/.test(window)) {
      outcome = "verified";
      evidence = "verified_language";
      hits++;
    } else if (/updated|modified|corrected|changed/.test(window)) {
      outcome = "updated";
      evidence = "updated_language";
      hits++;
    }
    outcomes.push({ itemId: String(it.id), outcome, evidence });
  }

  const confidence = items.length === 0 ? 0 : Math.min(0.99, 0.35 + (hits / items.length) * 0.55);
  const needsConfirm = confidence < 0.85;
  return { outcomes, confidence: Number(confidence.toFixed(3)), needsConfirm, rawPreview: raw.slice(0, 500) };
}

function excerptAround(lower, last4, creditor) {
  if (!lower) return "";
  let idx = -1;
  if (last4) idx = lower.indexOf(String(last4).toLowerCase());
  if (idx < 0 && creditor) idx = lower.indexOf(creditor);
  if (idx < 0) return lower.slice(0, 400);
  return lower.slice(Math.max(0, idx - 120), idx + 200);
}

export { OUTCOMES };

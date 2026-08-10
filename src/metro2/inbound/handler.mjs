// Inbound mailbox handler — OCR text in, parse out, hold if low confidence.

import { parseResponseText } from "./parse-response.mjs";
import { confirmParse } from "./confirm.mjs";

/**
 * Handle a virtual-mailbox / scanned response.
 * Does NOT auto-escalate on low confidence.
 */
export async function handleInboundResponse(db, {
  orgId,
  clientId,
  caseId,
  ocrText,
  items,
  autoConfirmThreshold = 0.85,
  confirmedBy = null
}) {
  const parseResult = parseResponseText({ text: ocrText, items });
  if (parseResult.needsConfirm || parseResult.confidence < autoConfirmThreshold) {
    return {
      status: "held",
      event: "repair.parse.low_confidence",
      parseResult
    };
  }
  const confirmed = await confirmParse(db, {
    orgId,
    clientId,
    caseId,
    items,
    parseResult,
    confirmedOutcomes: parseResult.outcomes,
    confirmedBy: confirmedBy || "system_high_confidence",
    threshold: autoConfirmThreshold
  });
  return {
    status: confirmed.ok ? "advanced" : "held",
    event: confirmed.ok ? "repair.response.parsed" : "repair.parse.low_confidence",
    parseResult,
    confirmed
  };
}

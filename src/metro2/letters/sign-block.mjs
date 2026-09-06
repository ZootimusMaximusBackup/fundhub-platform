// Signature / declaration blocks for letter and complaint PDFs.
// No Fundhub logo. Client signs by hand (letters) or on the declaration (complaints).
//
// COMPLIANCE REVIEW REQUIRED — credit-repair messaging.
//
// THE NAME UNDER THE SIGNATURE LINE IS THE SAME NAME AS THE LETTERHEAD, AND IT
// IS SUBJECT TO THE SAME ONE RULE: real, or the block is not built. A reviewer
// rendered a Round 1 packet on 2026-09-06 and got a page headed "Client" and
// footed "Signature: ____ Client". These two functions were the second half of
// that page. Both callers already refuse before they reach here; this is the
// backstop, so a future caller cannot reintroduce the placeholder by forgetting.
// ./consumer-name.cjs holds the predicate.
import { requireConsumerName } from "./consumer-name.mjs";

export function handwrittenSignOff(fullName) {
  const name = requireConsumerName(fullName, "signature block");
  return [
    "Sincerely,",
    "",
    "Signature: _______________________________",
    name,
    "Date: ____________________"
  ].join("\n");
}

export function perjuryDeclaration(fullName, { stateName = null } = {}) {
  const name = requireConsumerName(fullName, "perjury declaration");
  const oath = stateName
    ? `I declare under penalty of perjury under the laws of ${stateName} that the foregoing is true and correct to the best of my knowledge and belief.`
    : "I declare under penalty of perjury that the information provided in this complaint is true and accurate to the best of my knowledge.";
  return [
    "Section: Declaration",
    "",
    oath,
    "",
    "Signature: _______________________________",
    `Name: ${name}`,
    "Date: ____________________"
  ].join("\n");
}

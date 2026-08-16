// Signature / declaration blocks for letter and complaint PDFs.
// No Fundhub logo. Client signs by hand (letters) or on the declaration (complaints).

export function handwrittenSignOff(fullName) {
  const name = String(fullName || "").trim() || "[Consumer Name]";
  return [
    "Sincerely,",
    "",
    "Signature: _______________________________",
    name,
    "Date: ____________________"
  ].join("\n");
}

export function perjuryDeclaration(fullName, { stateName = null } = {}) {
  const name = String(fullName || "").trim() || "[FULL LEGAL NAME]";
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

// Draft-template hard guard.
//
// A template whose body or subject still carries a [DRAFT] marker must never
// reach a client — even if someone flipped compliance_passed to true. The
// seed path (workflow-keys.mjs) writes exactly that marker for missing copy.

const DRAFT_RE = /\[DRAFT\b/i;

/**
 * isDraftTemplateCopy(text) → true when the string is placeholder draft copy.
 */
export function isDraftTemplateCopy(text) {
  if (text == null) return false;
  return DRAFT_RE.test(String(text));
}

/**
 * isDraftTemplateRow(row) → true when body or subject is draft placeholder.
 */
export function isDraftTemplateRow(row = {}) {
  return isDraftTemplateCopy(row.body) || isDraftTemplateCopy(row.subject);
}

export { DRAFT_RE };
export default { isDraftTemplateCopy, isDraftTemplateRow, DRAFT_RE };

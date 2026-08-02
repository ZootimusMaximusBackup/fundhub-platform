/* Finds merge tags in journey step copy that are missing their second brace.
 *
 * src/lib/render-template.mjs only ever matches {{double braces}} — a single-
 * brace {first_name} is not a token to it, just three characters of literal
 * text. So a journey step saved with {first_name} would, if that copy were
 * ever rendered the way message_templates copy is, send the client the brace
 * characters instead of their name. This is the check that stops a single-
 * brace tag from being saved in the first place.
 *
 * TWO-PASS ON PURPOSE. A naive /\{(\w+)\}/ also matches inside a correct
 * {{first_name}} — the inner "{first_name}" substring satisfies it — so a
 * one-pass regex would flag every properly double-braced tag as broken too.
 * Stripping every real {{...}} token first, then checking what is left for a
 * stray {word}, is what keeps this from crying wolf on copy that is already
 * correct.
 */

const DOUBLE_BRACE_TOKEN = /\{\{\s*\w+(?:\.\w+)*\s*\}\}/g;
const SINGLE_BRACE_TOKEN = /\{(\w+)\}/g;

/** findSingleBraceTags — every distinct single-brace tag name in one string,
    in first-seen order. Null/undefined is normal (an SMS step has no subject). */
export function findSingleBraceTags(text) {
  if (text == null) return [];
  const withoutRealTokens = String(text).replace(DOUBLE_BRACE_TOKEN, "");
  const seen = new Set();
  for (const m of withoutRealTokens.matchAll(SINGLE_BRACE_TOKEN)) seen.add(m[1]);
  return [...seen];
}

/** findSingleBraceTagsInNodes — walks a journey's whole node tree (including
    every condition branch) and reports every sms/email step whose body or
    subject still holds a single-brace tag.
    Returns [{ nodeId, nodeTitle, field, tags }, ...], empty when the tree is clean. */
export function findSingleBraceTagsInNodes(nodes) {
  const violations = [];
  const walk = (list) => {
    for (const n of list || []) {
      if (n && (n.type === "sms" || n.type === "email")) {
        for (const field of ["body", "subject"]) {
          const tags = findSingleBraceTags(n.cfg?.[field]);
          if (tags.length) violations.push({ nodeId: n.id ?? null, nodeTitle: n.title ?? null, field, tags });
        }
      }
      for (const b of n?.branches || []) walk(b.nodes);
    }
  };
  walk(nodes);
  return violations;
}

export default findSingleBraceTagsInNodes;

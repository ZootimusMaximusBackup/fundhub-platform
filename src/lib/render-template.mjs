// Replaces {{ field }} / {{field}} / {{ contact.first_name }} merge tokens with values
// from context. Unknown tokens → empty string + console.warn so missing data is visible
// in logs.
//
// Dotted paths are the whole point: the ported GHL copy is written against
// `{{contact.first_name}}`, `{{contact.analyzer_prequal_amount}}`, `{{user.name}}`,
// `{{appointment.meeting_location}}`. `\w` excludes `.`, so the original pattern matched
// none of them and every dotted tag survived into the outbound SMS/email body literally,
// braces and all.
const TOKEN_RE = /\{\{\s*(\w+(?:\.\w+)*)\s*\}\}/g;

// Walks a dotted path. Returns { found } so a key that resolves to null stays
// distinguishable from a key that is missing: the first renders "" silently (the value
// is genuinely blank), the second warns (the data plumbing is broken).
function resolvePath(context, path) {
  // An exact key wins first — a caller may legitimately pass "contact.first_name" flat.
  if (Object.prototype.hasOwnProperty.call(context, path)) {
    return { found: true, value: context[path] };
  }
  let cur = context;
  for (const segment of path.split(".")) {
    if (cur == null || typeof cur !== "object") return { found: false };
    if (!Object.prototype.hasOwnProperty.call(cur, segment)) return { found: false };
    cur = cur[segment];
  }
  return { found: true, value: cur };
}

export function renderTemplate(body, context = {}) {
  const ctx = context || {};
  return String(body).replace(TOKEN_RE, (_match, path) => {
    const hit = resolvePath(ctx, path);
    if (!hit.found) {
      console.warn(`[renderTemplate] unknown token: {{${path}}}`);
      return "";
    }
    const val = hit.value;
    if (val == null) return "";
    // A partial path ({{contact}} when contact is the object) would otherwise stringify to
    // "[object Object]" and send that to a customer. Blank is the safer failure.
    if (typeof val === "object") {
      console.warn(`[renderTemplate] non-scalar token: {{${path}}}`);
      return "";
    }
    return String(val);
  });
}

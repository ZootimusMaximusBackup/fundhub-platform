// Replaces {{ field }} / {{field}} merge tokens with values from context.
// Unknown tokens → empty string + console.warn so missing data is visible in logs.
const TOKEN_RE = /\{\{\s*(\w+)\s*\}\}/g;

export function renderTemplate(body, context = {}) {
  return String(body).replace(TOKEN_RE, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      const val = context[key];
      return val == null ? "" : String(val);
    }
    console.warn(`[renderTemplate] unknown token: {{${key}}}`);
    return "";
  });
}

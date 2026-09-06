// HTML escaping for the ported client deliverables.
//
// scripts/black-reports/fundhub_gen.py:236 escapes only & < > because
// WeasyPrint rendered the markup once, offline, into a PDF. These documents are
// now hosted web pages carrying real client data, so this copies the house
// helper at src/brand/partner-site.mjs:4-8 instead, which also escapes the two
// quote characters and so is safe inside an attribute value.
//
// THE LIMIT, AND IT IS DELIBERATE: this does NOT escape ; { } ( ), so it is not
// safe inside a <style> block. Never interpolate a client value into CSS.
// Everything the renderer puts in CSS is a module literal.

const MAP = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
});

/** Escape a value for use as HTML text or inside a quoted attribute. */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => MAP[c]);
}

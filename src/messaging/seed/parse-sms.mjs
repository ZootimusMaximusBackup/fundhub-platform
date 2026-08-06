// Parser for fundhub-docs/sources/SMS-TEMPLATES-CURRENT.md.
//
// This is a PARSER, not a transcription: the seeder re-reads the markdown on
// every run, so a copy edit in the doc re-seeds without a code change. Copy is
// taken VERBATIM — nothing here rewrites, reflows, or "fixes" a body.
//
// Format (owner-set 2026-08-06 — supersedes SMS-Compliant-Rewrites.md and
// Workflow-SMS-Fixes-Ready-to-Paste.md):
//
//   ## TEMPLATE-KEY
//
//   Plain-text body lines…
//
// One `## KEY` heading per template. Body is every non-heading line until the
// next `##` (or EOF), with leading/trailing blank lines trimmed. No blockquotes.

// Uppercase, non-alphanumerics collapsed to a single dash. Kept for callers that
// still derive stable keys from free-text headers (workflow audit helpers).
export function slugifyKey(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

// Header -> template_key for legacy workflow-inline SMS keys still referenced in
// WORKFLOW_DOC_ALIASES. Deterministic so the same header always yields the same key.
export function workflowTemplateKey(header, index) {
  const cleaned = String(header)
    .replace(/⚠️?[\s\S]*$/u, "")
    .replace(/\(\s*\d+\s+messages?\s*\)\s*$/i, "")
    .trim();
  return `SMS-WF-${slugifyKey(cleaned)}-${String(index + 1).padStart(2, "0")}`;
}

// Contiguous `>` lines — kept as a pure helper; the current SMS source doc does
// not use blockquotes, but tests and older fixtures still exercise this.
export function blockquoteBlocks(lines) {
  const blocks = [];
  let cur = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*>/.test(lines[i])) {
      const text = lines[i].replace(/^\s*>\s?/, "");
      if (cur) cur.lines.push(text);
      else cur = { start: i, lines: [text] };
    } else if (cur) {
      blocks.push(cur);
      cur = null;
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

// SMS-TEMPLATES-CURRENT.md -> [{templateKey, channel, body, sourceDoc, ...}]
export function parseSmsCurrent(markdown, sourceDoc) {
  const lines = String(markdown).split(/\r?\n/);
  const sections = [];
  let cur = null;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (cur) sections.push(cur);
      cur = { key: line.replace(/^##\s+/, "").trim(), lines: [] };
    } else if (/^#\s+/.test(line)) {
      // Top-level title closes any open template section.
      if (cur) sections.push(cur);
      cur = null;
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) sections.push(cur);

  return sections.map((s) => {
    // Trim leading/trailing blank lines only — interior whitespace and wording
    // stay verbatim.
    let start = 0;
    let end = s.lines.length;
    while (start < end && /^\s*$/.test(s.lines[start])) start += 1;
    while (end > start && /^\s*$/.test(s.lines[end - 1])) end -= 1;
    const body = s.lines.slice(start, end).join("\n");
    return {
      templateKey: s.key,
      channel: "sms",
      subject: null,
      body,
      compliancePassed: true, // post-compliance rewrite (SMS-TEMPLATES-CURRENT.md)
      sourceDoc,
      label: s.key,
    };
  });
}

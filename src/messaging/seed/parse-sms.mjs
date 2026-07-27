// Parsers for the two SMS source docs in fundhub-docs/sources.
//
// These are PARSERS, not transcriptions: the seeder re-reads the markdown on
// every run, so a copy edit in the doc re-seeds without a code change. Copy is
// taken VERBATIM — nothing here rewrites, reflows, or "fixes" a body.
//
//   SMS-Compliant-Rewrites.md            — 18 snippet-library SMS. `### KEY`
//                                          headers; body is the blockquote,
//                                          which follows `**After:**` for the 9
//                                          reworded ones and comes straight
//                                          after the header for the 9 clean ones.
//   Workflow-SMS-Fixes-Ready-to-Paste.md — SMS written inline in workflow steps
//                                          (no snippet key exists), `## Header`
//                                          per workflow, one blockquote per
//                                          message. Keys are DERIVED from the
//                                          header — see workflowTemplateKey().

// A contiguous run of `>` lines is one blockquote block. Markdown ends a block
// on a blank line, and these docs never blank-line inside a quote.
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

// Uppercase, non-alphanumerics collapsed to a single dash. Deterministic, so the
// same header always yields the same template_key across re-seeds.
export function slugifyKey(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

// Header -> template_key for the workflow-inline SMS. The workflow builder gives
// these no ID of their own, so we mint one: SMS-WF- marks "lives inside a
// workflow step, not the snippet library", and the trailing index disambiguates
// the multi-message cadences (AI-SET-03 sends three).
export function workflowTemplateKey(header, index) {
  const cleaned = String(header)
    .replace(/⚠️?[\s\S]*$/u, "") // drop the "⚠️ needs your real link" annotations
    .replace(/\(\s*\d+\s+messages?\s*\)\s*$/i, "")
    .trim();
  return `SMS-WF-${slugifyKey(cleaned)}-${String(index + 1).padStart(2, "0")}`;
}

// SMS-Compliant-Rewrites.md -> [{templateKey, channel, body, sourceDoc, ...}]
export function parseSmsRewrites(markdown, sourceDoc) {
  const lines = String(markdown).split(/\r?\n/);
  const sections = [];
  let cur = null;
  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      if (cur) sections.push(cur);
      cur = { key: line.replace(/^###\s+/, "").trim(), lines: [] };
    } else if (/^#{1,2}\s+/.test(line)) {
      // A `#`/`##` heading closes the current template (the A/B group headers).
      if (cur) sections.push(cur);
      cur = null;
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) sections.push(cur);

  return sections.map((s) => {
    const afterAt = s.lines.findIndex((l) => /^\s*\*\*After:\*\*/i.test(l));
    // When the doc carries both a Before and an After, the After is the copy of
    // record; with no marker at all the first blockquote is the body.
    const scope = afterAt === -1 ? s.lines : s.lines.slice(afterAt + 1);
    const block = blockquoteBlocks(scope)[0];
    return {
      templateKey: s.key,
      channel: "sms",
      subject: null,
      body: block ? block.lines.join("\n") : "",
      compliancePassed: true, // audited in SMS-Compliance-Audit.md, rewritten here
      sourceDoc,
      label: s.key,
    };
  });
}

// Workflow-SMS-Fixes-Ready-to-Paste.md -> one row per blockquote in each section.
export function parseWorkflowInlineSms(markdown, sourceDoc) {
  const lines = String(markdown).split(/\r?\n/);
  const sections = [];
  let cur = null;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (cur) sections.push(cur);
      cur = { header: line.replace(/^##\s+/, "").trim(), lines: [] };
    } else if (/^#\s+/.test(line)) {
      if (cur) sections.push(cur);
      cur = null;
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) sections.push(cur);

  const out = [];
  for (const s of sections) {
    const blocks = blockquoteBlocks(s.lines);
    blocks.forEach((block, i) => {
      out.push({
        templateKey: workflowTemplateKey(s.header, i),
        channel: "sms",
        subject: null,
        body: block.lines.join("\n"),
        compliancePassed: true, // these ARE the audited rewrites
        sourceDoc,
        label: blocks.length > 1 ? `${s.header} (message ${i + 1})` : s.header,
      });
    });
  }
  return out;
}

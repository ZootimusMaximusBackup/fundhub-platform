// Parser for fundhub-docs/sources/EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md (162 emails
// extracted from the GHL builder, plus owner-supplied DRAFT fill-ins).
//
// Each template is fenced:
//
//   ================================================================================
//   ## AF-06   Affiliate Reactivation      [folder: (root)]
//   ================================================================================
//   Want to reactivate your affiliate stream?      <- subject (first line)
//                                                  <- everything below is the body
//    Hey {{contact.first_name}},
//    ...
//
// The header is `KEY`, then the human name, then `[folder: X]`, separated by runs
// of 2+ spaces (single spaces occur inside the name, so a plain split on " "
// would shred it). KEY is used as template_key verbatim — these are the existing
// GHL IDs and the workflows reference them by that name.
//
// Body copy is VERBATIM, including the GHL export's leading space on each line
// and its footer/Unsubscribe lines. The only whitespace touched is wholly-blank
// leading/trailing lines, which are document structure rather than copy.

const FENCE = /^={8,}\s*$/;

export function parseEmailTemplates(markdown, sourceDoc) {
  const lines = String(markdown).split(/\r?\n/);

  // Locate each `fence / ## header / fence` triple.
  const starts = [];
  for (let i = 0; i + 2 < lines.length; i += 1) {
    if (FENCE.test(lines[i]) && /^##\s+/.test(lines[i + 1]) && FENCE.test(lines[i + 2])) {
      starts.push(i);
    }
  }

  return starts.map((start, n) => {
    const header = parseHeader(lines[start + 1]);
    const end = n + 1 < starts.length ? starts[n + 1] : lines.length;
    const { subject, body } = splitSubjectBody(lines.slice(start + 3, end));
    return {
      templateKey: header.key,
      channel: "email",
      subject,
      body,
      compliancePassed: false, // emails are never auto-marked compliance_passed
      sourceDoc,
      label: header.name ? `${header.key} — ${header.name}` : header.key,
      folder: header.folder,
    };
  });
}

export function parseHeader(headerLine) {
  const raw = String(headerLine).replace(/^##\s+/, "").trim();
  const folderAt = raw.match(/\[folder:\s*([^\]]*)\]\s*$/i);
  const folder = folderAt ? folderAt[1].trim() : null;
  const rest = (folderAt ? raw.slice(0, folderAt.index) : raw).trim();
  const parts = rest.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
  return { key: parts[0] || "", name: parts.slice(1).join(" "), folder };
}

function splitSubjectBody(sectionLines) {
  const lines = [...sectionLines];
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (!lines.length) return { subject: "", body: "" };

  const subject = lines[0].trim();
  const body = [...lines.slice(1)];
  while (body.length && body[0].trim() === "") body.shift();
  while (body.length && body[body.length - 1].trim() === "") body.pop();
  return { subject, body: body.join("\n") };
}

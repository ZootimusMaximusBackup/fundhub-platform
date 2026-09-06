// Draft dispute letter for one bureau — personal-information + inquiry
// reinvestigation demand (15 U.S.C. §1681i).
//
// COMPLIANCE REVIEW REQUIRED: dispute messaging. Draft only — never sends.
// Per-client variance is required so mass-identical letters are not produced.
//
// THE NAME ON IT. A draft is printed, signed and posted by a person; "draft"
// describes who presses send, not whether the words are real. So this file obeys
// the same one rule as every other renderer in the repository: the name at the
// top and under "Sincerely" is a real name or THERE IS NO DRAFT. It used to fall
// back to the literal word "Consumer" — a dispute demand under 15 U.S.C. §1681i,
// addressed to Experian, signed "Consumer".
// ../metro2/letters/consumer-name.cjs holds the predicate.

import { realConsumerName } from "../metro2/letters/consumer-name.mjs";

const OPENERS = [
  "I am writing to formally dispute certain information appearing on my credit file",
  "Please accept this letter as my written demand for reinvestigation under the FCRA",
  "This correspondence disputes inaccurate and incomplete items on my consumer report"
];

const PI_BRIDGES = [
  "The following identifying information does not belong on my file and must be reinvestigated",
  "These personal-information entries are inaccurate or outdated and require correction",
  "My file lists identifying data that is wrong or no longer applicable"
];

const INQ_BRIDGES = [
  "I also dispute the hard inquiries listed below and demand reinvestigation of each",
  "The inquiries in the table below are disputed; please reinvestigate each furnisher entry",
  "Please reinvestigate each of the following hard inquiries and correct or delete as required"
];

const CLOSERS = [
  "Please complete your reinvestigation and send written results to the address above.",
  "Kindly confirm each correction in writing once your reinvestigation is finished.",
  "I expect a written response with the outcome of each item within the time the FCRA allows."
];

function pick(list, seed) {
  const i = Math.abs(Number(seed) || 0) % list.length;
  return list[i];
}

function hashSeed(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const BUREAU_NAMES = Object.freeze({
  EX: "Experian",
  EQ: "Equifax",
  TU: "TransUnion"
});

/**
 * @param {{
 *   client: { first_name?: string, last_name?: string, email?: string, address?: string },
 *   bureau: string,
 *   inquiries?: object[],
 *   pii?: object[],
 *   today?: string
 * }} opts
 * @returns {string|null} HTML draft, or NULL when the client has no real name on
 *   record. Null means unknown and callers must let it stay unknown — storing
 *   null in `inquiry_removal_cases.letter_draft_html` (nullable) is the correct
 *   outcome. Do not substitute a placeholder draft.
 */
export function renderLetterDraft(opts = {}) {
  const bureau = String(opts.bureau || "EX").toUpperCase();
  const bureauName = BUREAU_NAMES[bureau] || bureau;
  const client = opts.client || {};
  const first = client.first_name || client.firstName || "";
  const last = client.last_name || client.lastName || "";
  const fullName = realConsumerName([first, last].filter(Boolean).join(" "));
  // No name, no draft. See the header.
  if (!fullName) return null;
  const inquiries = Array.isArray(opts.inquiries) ? opts.inquiries : [];
  const pii = Array.isArray(opts.pii) ? opts.pii : [];
  const today = opts.today || new Date().toISOString().slice(0, 10);

  const seed = hashSeed(`${fullName}|${bureau}|${inquiries.length}|${pii.length}|${today}`);
  const opener = pick(OPENERS, seed);
  const piBridge = pick(PI_BRIDGES, seed >> 3);
  const inqBridge = pick(INQ_BRIDGES, seed >> 5);
  const closer = pick(CLOSERS, seed >> 7);

  const addr = client.address || client.mailing_address || "";
  const email = client.email || "";

  const piiRows = pii
    .map(
      (p) =>
        `<li><strong>${escapeHtml(p.category || "item")}</strong>: ${escapeHtml(p.value || p.inquiry_name || "")}</li>`
    )
    .join("\n");

  const inqRows = inquiries
    .map((i) => {
      const name = escapeHtml(i.inquiry_name || i.inquiry || "");
      const date = escapeHtml(i.inquiry_date || "date unknown");
      return `<tr><td>${name}</td><td>${date}</td></tr>`;
    })
    .join("\n");

  const piiSection = pii.length
    ? `<h2>Identifying information disputes</h2>
<p>${escapeHtml(piBridge)}:</p>
<ul>
${piiRows}
</ul>`
    : "";

  const inqSection = inquiries.length
    ? `<h2>Hard inquiry disputes</h2>
<p>${escapeHtml(inqBridge)}:</p>
<table>
<thead><tr><th>Furnisher</th><th>Date</th></tr></thead>
<tbody>
${inqRows}
</tbody>
</table>`
    : "";

  // Structural variance: order of sections flips based on seed bit.
  const bodySections = seed & 1 ? `${piiSection}\n${inqSection}` : `${inqSection}\n${piiSection}`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Dispute — ${escapeHtml(bureauName)}</title></head>
<body>
<p>${escapeHtml(today)}</p>
<p>${escapeHtml(fullName)}<br>${escapeHtml(addr)}<br>${escapeHtml(email)}</p>
<p>To: ${escapeHtml(bureauName)} Consumer Dispute Department</p>
<p>Re: Personal-information and inquiry reinvestigation demand — 15 U.S.C. §1681i</p>
<p>Dear ${escapeHtml(bureauName)},</p>
<p>${escapeHtml(opener)}. My file with your bureau shows items that are inaccurate or incomplete. Under 15 U.S.C. §1681i I demand a reinvestigation of each item below.</p>
${bodySections}
<p>${escapeHtml(closer)}</p>
<p>Sincerely,<br>${escapeHtml(fullName)}</p>
</body></html>`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

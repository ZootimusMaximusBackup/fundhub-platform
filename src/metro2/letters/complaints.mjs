// CFPB and state AG complaint drafts from engine findings + case timeline.
// Fill only facts passed in. Never invent mail dates or Metro 2 fields.

import { LETTER_TYPES } from "./catalog.mjs";
import { hasMetro2Claim } from "./generate.mjs";
import { agForState, CFPB_FILING, BUREAU_DISPUTE_ADDRESSES } from "./ag-statutes.mjs";
import { perjuryDeclaration } from "./sign-block.mjs";
import { renderLetterPdf } from "./render.mjs";
import { requireConsumerName } from "./consumer-name.mjs";

const DATE_NOT_MAILED = "[DATE — not mailed yet]";
const DATE_BLANK = "Date: ____________________";
const HARM_BLANK = "[DESCRIBE HARM]";

function complaintHeading(type) {
  if (type === LETTER_TYPES.STATE_AG_COMPLAINT) {
    return "STATE ATTORNEY GENERAL CONSUMER COMPLAINT";
  }
  return "CONSUMER FINANCIAL PROTECTION BUREAU COMPLAINT";
}

/* THE NAME ON A COMPLAINT SWORN UNDER PENALTY OF PERJURY IS A REAL NAME OR THE
   COMPLAINT IS NOT BUILT. "[FULL LEGAL NAME]" used to stand here as a blank the
   client would fill in by hand; it is gone because it also stood in for a name
   the code had simply lost, and the two are indistinguishable on the page.
   ./consumer-name.cjs holds the one predicate; a refusal throws, which is how
   ./generate.mjs already refuses a letter with no rule-backed claim. */
function consumerName(identity) {
  return requireConsumerName(identity?.fullName, "consumer complaint");
}

function complaintDateLine(undated, date) {
  if (undated) return DATE_BLANK;
  const d = date != null ? String(date).trim() : "";
  return d ? `Date: ${d}` : DATE_BLANK;
}

function identityBlock(identity = {}) {
  const cityLine = [identity.city, identity.state, identity.zip].filter(Boolean).join(", ");
  return [
    consumerName(identity),
    identity.addressLine1,
    cityLine,
    identity.email ? `Email: ${identity.email}` : null,
    identity.phone ? `Phone: ${identity.phone}` : null
  ].filter(Boolean).join("\n");
}

function bureauPoBoxReference() {
  return Object.values(BUREAU_DISPUTE_ADDRESSES).map((b) => `${b.name} — ${b.poBox}`);
}

function bureauHqReference() {
  return Object.values(BUREAU_DISPUTE_ADDRESSES).map((b) => `${b.name} — ${b.hq}`);
}

function companyBlock(company, { includeHq = false } = {}) {
  if (company?.name || company?.address) {
    const lines = [
      "COMPANY INFORMATION",
      "",
      company.name || "[COMPANY NAME]",
      company.address || null,
      company.kind ? `Kind: ${company.kind}` : null
    ];
    if (includeHq) {
      lines.push(
        "",
        "Nationwide consumer reporting agency headquarters (for reference):",
        ...bureauHqReference()
      );
    }
    return lines.filter((l) => l !== null).join("\n");
  }
  const lines = [
    "COMPANY INFORMATION",
    "",
    "No single company was named. For reference, the nationwide consumer reporting agency dispute addresses are:",
    ...bureauPoBoxReference()
  ];
  if (includeHq) {
    lines.push("", "Headquarters (for reference):", ...bureauHqReference());
  }
  return lines.join("\n");
}

function formatViolation(v) {
  if (!v) return null;
  const parts = [];
  if (v.ruleId) parts.push(String(v.ruleId));
  if (v.field != null && String(v.field).trim() !== "") {
    parts.push(`Field ${v.field}`);
  }
  if (v.reason) parts.push(String(v.reason));
  return parts.length ? `  - ${parts.join(" — ")}` : null;
}

/*
 * A complaint is signed under penalty of perjury. The Metro 2 heading is a
 * statement that our engine found a Metro 2 field defect on this account, so it
 * prints only when the account actually carries an M2- rule.
 *
 * The derogatory-item claims in ../diy/derogatory.mjs (DEROG-COLLECTION,
 * DEROG-CHARGEOFF, DEROG-LATE) carry a ruleId and a null field on purpose:
 * they assert the consumer's right to a reinvestigation, not a format defect.
 * Under the old unconditional heading a consumer swore to the CFPB or a state
 * attorney general that Metro 2 field violations were reported, when nothing in
 * the engine had made that finding.
 *
 * hasMetro2Claim is the SAME predicate the dispute letters use in
 * ./generate.mjs — one implementation, and a mixed account keeps the Metro 2
 * heading there for the same reason it keeps it here: the Metro 2 claim really
 * is present. The per-item lines below are unchanged; they were already true.
 */
const METRO2_HEADING = "Metro 2 field violations reported on this account:";
const PLAIN_HEADING = "Items disputed on this account:";

function accountsHeading(violations) {
  return hasMetro2Claim(violations) ? METRO2_HEADING : PLAIN_HEADING;
}

function accountsBlock(accounts = []) {
  const list = Array.isArray(accounts) ? accounts : [];
  if (!list.length) {
    return ["DISPUTED ACCOUNTS", "", "No accounts were listed."].join("\n");
  }
  const chunks = list.map((a, i) => {
    const viols = (a.fieldViolations || []).map(formatViolation).filter(Boolean);
    return [
      `Account ${i + 1}`,
      a.creditor ? `Creditor: ${a.creditor}` : null,
      a.accountType ? `Account type: ${a.accountType}` : null,
      a.amount != null && a.amount !== "" ? `Amount: ${a.amount}` : null,
      a.originalCreditor ? `Original creditor: ${a.originalCreditor}` : null,
      viols.length ? accountsHeading(a.fieldViolations) : null,
      ...viols
    ]
      .filter((l) => l != null)
      .join("\n");
  });
  return ["DISPUTED ACCOUNTS", "", ...chunks].join("\n\n");
}

function timelineDate(entry) {
  const d = entry?.date;
  if (d == null || String(d).trim() === "") return DATE_NOT_MAILED;
  return String(d).trim();
}

function formatRound(round) {
  if (round == null || String(round).trim() === "") return "Round";
  const s = String(round).trim();
  if (/^r[123]$/i.test(s)) return s.toUpperCase();
  if (/^[123]$/.test(s)) return `R${s}`;
  return s;
}

function timelineBlock(timeline = []) {
  const list = Array.isArray(timeline) ? timeline : [];
  const lines = list.map((entry) => {
    const round = formatRound(entry?.round);
    const date = timelineDate(entry);
    const summary = entry?.summary ? String(entry.summary) : "";
    return `- ${round} (${date}): ${summary}`.trim();
  });
  return [
    "WHAT HAPPENED",
    "",
    "I disputed inaccurate information with the consumer reporting agencies. Here is the timeline:",
    ...lines
  ].join("\n");
}

function fcraBlock() {
  return [
    "FAIR CREDIT REPORTING ACT DUTIES",
    "",
    "I rely on the following duties under the Fair Credit Reporting Act:",
    "- FCRA § 611(a)(1)(A): a reasonable reinvestigation of the disputed information.",
    "- FCRA § 611(a)(7): a description of the method of verification, on request, after reinvestigation.",
    "- FCRA § 611(a)(6)(B)(iii): a description of the procedure used to determine accuracy and completeness, including the business name, address, and telephone number of any furnisher contacted.",
    "- FCRA § 611(a)(5)(A): prompt deletion or modification of information found inaccurate, incomplete, or unverifiable.",
    "- FCRA § 607(b): reasonable procedures to assure maximum possible accuracy of the information concerning the individual about whom the report relates."
  ].join("\n");
}

function defaultWants() {
  return [
    "Delete the inaccurate and unverifiable accounts and information listed above from my consumer reports.",
    "Send me written confirmation of each deletion.",
    "Do not reinsert any deleted item without the written notice required by FCRA § 611(a)(5)(B).",
    "Provide me an updated consumer report showing the results.",
    "Investigate the company's dispute handling."
  ];
}

function wantsBlock(wants) {
  let items;
  if (Array.isArray(wants) && wants.length) {
    items = wants.map((w) => String(w));
  } else if (typeof wants === "string" && wants.trim()) {
    items = [wants.trim(), ...defaultWants()];
  } else {
    items = defaultWants();
  }
  return ["WHAT I WANT", "", ...items.map((w) => `- ${w}`)].join("\n");
}

function harmBlock(harm) {
  const text = harm != null && String(harm).trim() ? String(harm).trim() : HARM_BLANK;
  return ["HARM", "", text].join("\n");
}

function supportingDocsBlock() {
  return [
    "SUPPORTING DOCUMENTS CHECKLIST",
    "",
    "I am attaching, or will attach when I file:",
    "- Government-issued photo identification",
    "- Proof of current address",
    "- Copies of my consumer reports showing the disputed accounts",
    "- Copies of my Round 1, Round 2, and Round 3 dispute letters",
    "- Certified-mail receipts and return receipts for rounds that were mailed",
    "- Written responses from the company, if any were received",
    "- Any account statements, contracts, or payment records I have for the listed accounts"
  ].join("\n");
}

function cfpbFilingBlock() {
  return [
    "HOW TO FILE",
    "",
    `Online portal: ${CFPB_FILING.portal}`,
    `Phone: ${CFPB_FILING.phone} (${CFPB_FILING.hours})`,
    `Mail: ${CFPB_FILING.mail}`,
    `After the CFPB forwards this complaint, the company has ${CFPB_FILING.companyResponseDays} days to respond.`
  ].join("\n");
}

function agStatuteBlock(ag) {
  const lines = ["STATE CONSUMER-PROTECTION LAW", "", ag.statute];
  if (Array.isArray(ag.cites) && ag.cites.length) {
    lines.push("", "Statutory cites:", ...ag.cites.map((c) => `- ${c}`));
  }
  return lines.join("\n");
}

function agReliefBlock(ag) {
  const blob = [ag.statute, ...(ag.cites || [])].join(" ");
  const items = [
    "Open an investigation into the company's handling of my disputes and the accuracy of my consumer file.",
    "Compel deletion of the inaccurate and unverifiable accounts from my consumer reports.",
    "Order restitution for the harm described in this complaint."
  ];
  if (/treble/i.test(blob)) {
    items.push("Impose treble damages as provided by the statute cited above.");
  }
  if (/civil penalt/i.test(blob)) {
    items.push("Impose civil penalties as provided by the statute cited above.");
  }
  return ["RELIEF REQUESTED", "", ...items.map((x) => `- ${x}`)].join("\n");
}

function agFilingBlock(ag) {
  return ["HOW TO FILE", "", `Office: ${ag.office}`, `Filing portal: ${ag.portal}`].join("\n");
}

export function buildCfpbComplaint({
  identity,
  company,
  accounts,
  timeline,
  wants,
  harm,
  undated,
  date
} = {}) {
  const name = consumerName(identity);
  return [
    complaintHeading(LETTER_TYPES.CFPB_COMPLAINT),
    "",
    complaintDateLine(undated, date),
    "",
    cfpbFilingBlock(),
    "",
    "CONSUMER INFORMATION",
    "",
    identityBlock(identity),
    "",
    companyBlock(company, { includeHq: false }),
    "",
    timelineBlock(timeline),
    "",
    accountsBlock(accounts),
    "",
    fcraBlock(),
    "",
    wantsBlock(wants),
    "",
    harmBlock(harm),
    "",
    supportingDocsBlock(),
    "",
    perjuryDeclaration(name)
  ].join("\n");
}

export function buildStateAgComplaint({
  identity,
  company,
  accounts,
  timeline,
  harm,
  undated,
  date
} = {}) {
  const name = consumerName(identity);
  const ag = agForState(identity?.state);
  return [
    complaintHeading(LETTER_TYPES.STATE_AG_COMPLAINT),
    "",
    `${ag.office}`,
    "",
    complaintDateLine(undated, date),
    "",
    agFilingBlock(ag),
    "",
    "CONSUMER INFORMATION",
    "",
    identityBlock(identity),
    "",
    companyBlock(company, { includeHq: true }),
    "",
    timelineBlock(timeline),
    "",
    accountsBlock(accounts),
    "",
    fcraBlock(),
    "",
    agStatuteBlock(ag),
    "",
    harmBlock(harm),
    "",
    wantsBlock(),
    "",
    agReliefBlock(ag),
    "",
    supportingDocsBlock(),
    "",
    perjuryDeclaration(name, { stateName: ag.stateName })
  ].join("\n");
}

export async function renderComplaintPdf(text, identity) {
  return renderLetterPdf({ text, identity });
}

// One-shot: live CRS sandbox pull → engine-backed Round 1 letters → Chris's inbox.
// No Fundhub mark on the PDFs. Not a bureau mailing. Inquiry phone remover stays on hold.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./load-env.mjs";
import { createCrsClient } from "../src/finance/crs-client.mjs";
import {
  BUREAUS,
  SANDBOX_TEST_IDENTITIES,
  identityForBureau
} from "../src/finance/crs-identities.mjs";
import { normalizeFromCrs } from "../src/metro2/normalize.mjs";
import { runReport } from "../src/metro2/checks/index.mjs";
import { valueOf } from "../src/metro2/provenance.mjs";
import { renderLetterPdf } from "../src/metro2/letters/render.mjs";
import { send as sendResend } from "../src/messaging/providers/resend.mjs";

loadEnv();
process.env.ADAPTERS_DRY_RUN = "0";
process.env.MESSAGING_DRY_RUN = "0";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "scripts/tmp-sandbox-letters");
const TO = "stanbridgejchris@gmail.com";
const LETTER_DATE = "August 15, 2026";
const ONLY_PERSONAL = process.argv.includes("--only-personal");
const MAX_ITEMS = 5;
const PERSONAL_RULES = new Set(["M2-031", "M2-032", "M2-033", "M2-034"]);
const INQUIRY_RULES = new Set(["M2-035", "M2-036", "M2-037", "M2-038"]);

const BUREAU_META = {
  TU: {
    code: "TU",
    name: "TransUnion",
    who: "TransUnion Consumer Solutions",
    addr: ["P.O. Box 2000", "Chester, PA 19016"]
  },
  EX: {
    code: "EX",
    name: "Experian",
    who: "Experian",
    addr: ["P.O. Box 4500", "Allen, TX 75013"]
  },
  EQ: {
    code: "EQ",
    name: "Equifax",
    who: "Equifax Information Services LLC",
    addr: ["P.O. Box 740256", "Atlanta, GA 30374"]
  }
};

function titleCase(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function formatName(id) {
  return [id.firstName, id.middleName, id.lastName].filter(Boolean).map(titleCase).join(" ");
}

function formatAddress(id) {
  const a = id.addresses?.[0] || {};
  const zip = String(a.postalCode || "").replace(/\D/g, "");
  const zip5 = zip.length >= 5 ? zip.slice(0, 5) : zip;
  return {
    line1: titleCase(a.addressLine1 || ""),
    city: titleCase(a.city || ""),
    state: String(a.state || "").toUpperCase(),
    zip: zip5
  };
}

function formatDob(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

function formatIsoLong(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

function daysBetween(a, b) {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 86400000);
}

function ssnLast4(ssn) {
  const d = String(ssn || "").replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : null;
}

function reportAsOf(report) {
  const files = Array.isArray(report?.creditFiles) ? report.creditFiles : [];
  for (const f of files) {
    const d = f?.creditFileDetail?.creditFileInfileDate;
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  }
  const requested = report?.responseDetail?.dateRequested;
  if (typeof requested === "string" && /^\d{4}-\d{2}-\d{2}/.test(requested)) {
    return requested.slice(0, 10);
  }
  return null;
}

function attachTradeline(v, tradeline) {
  return {
    ...v,
    creditor: valueOf(tradeline?.creditor),
    accountLast4: valueOf(tradeline?.account_number_last4),
    doai: valueOf(tradeline?.field_24_date_of_account_info)
  };
}

function pickOldestStale(items, n) {
  return [...items]
    .sort((a, b) => String(a.doai || a.observed || "").localeCompare(String(b.doai || b.observed || "")))
    .slice(0, n);
}

function pickStrongestInquiries(items, n) {
  return [...items]
    .sort((a, b) => (b.observed?.occurrence || 0) - (a.observed?.occurrence || 0))
    .slice(0, n);
}

function headerBlock({ identity, bureau, subject, asOf }) {
  const addr = formatAddress(identity);
  const name = formatName(identity);
  const last4 = ssnLast4(identity.ssn);
  const dob = formatDob(identity.birthDate);
  const meta = BUREAU_META[bureau];
  const lines = [
    name,
    addr.line1,
    `${addr.city}, ${addr.state} ${addr.zip}`,
    last4 ? `SSN ending ${last4}` : null,
    dob ? `Date of birth: ${dob}` : null,
    "",
    LETTER_DATE,
    "",
    meta.who,
    ...meta.addr,
    "",
    `Re: ${subject}`
  ].filter((l) => l !== null);
  return lines.join("\n");
}

function enclosures() {
  return [
    "Enclosures:",
    "Copy of government-issued identification",
    "Proof of current address"
  ].join("\n");
}

const VIOLATION_NAMES = {
  "M2-005": "Stale Date of Account Information",
  "M2-031": "Stale former address",
  "M2-036": "Duplicate same-day inquiry"
};

const SEVERITY_LABEL = {
  deletion: "Deletion-tier",
  strong: "Strong",
  moderate: "Moderate",
  supporting: "Supporting"
};

function metro2FieldLine(v) {
  if (String(v.field) === "24") return "Metro 2 Field 24 — Date of Account Information";
  if (v.field === "address") return "Metro 2 personal-information / address segment";
  if (v.field === "inquiry") return "Metro 2 inquiry segment";
  if (v.metro2Ref) return `Metro 2: ${v.metro2Ref}`;
  return v.field ? `Metro 2 Field ${v.field}` : "Metro 2 reporting defect";
}

function violationBanner(v) {
  const name = VIOLATION_NAMES[v.ruleId] || v.ruleId;
  const sev = SEVERITY_LABEL[v.severity] || v.severity || "Moderate";
  return [
    `Violation ${v.ruleId} — ${name}`,
    metro2FieldLine(v),
    `Severity: ${sev}`,
    v.metro2Ref ? `Knowledge-base reference: ${v.metro2Ref}` : null
  ].filter(Boolean).join("\n");
}

function attorneyGeneralFor(identity) {
  const st = String(identity?.addresses?.[0]?.state || "").toUpperCase();
  if (st === "TX") return "the Texas Attorney General";
  if (st === "HI") return "the Hawaii Attorney General";
  return "my state attorney general";
}

function disputeItem(v, asOf, voice) {
  const creditor = v.creditor || "the furnisher named on the report";
  const last4 = v.accountLast4 ? ` ending ${v.accountLast4}` : "";
  const doai = typeof v.observed === "string" ? v.observed : v.doai;
  const age = doai && asOf ? daysBetween(doai, asOf) : null;
  const doaiLong = formatIsoLong(doai);
  const asOfLong = formatIsoLong(asOf);
  let fact;
  if (voice === "TU") {
    fact = [
      `Alleged account: ${creditor}${last4}.`,
      `TransUnion reports Field 24 as ${doaiLong || doai}.`,
      age != null
        ? `That is ${age} days before the report date of ${asOfLong}.`
        : `That date is older than the report date of ${asOfLong}.`,
      "A furnisher must update monthly. A stale Field 24 means the balance and status on this tradeline may no longer describe the account.",
      "Requested action: reinvestigate Field 24, the current balance, and the status. Correct the date or delete the tradeline if it cannot be verified.",
      "Authority: 15 U.S.C. § 1681e(b); 15 U.S.C. § 1681s-2(a)(2)."
    ].join(" ");
  } else if (voice === "EX") {
    fact = [
      `Alleged account: ${creditor}${last4}.`,
      `Experian reports Field 24 (last updated) as ${doaiLong || doai}.`,
      age != null
        ? `The Experian file date is ${asOfLong}, ${age} days later.`
        : `The Experian file date is ${asOfLong}.`,
      "Those two dates cannot both describe a currently maintained Metro 2 tradeline.",
      "Requested action: reinvestigate Field 24. If the furnisher cannot produce current Metro 2 data, delete or correct the tradeline.",
      "Authority: 15 U.S.C. §§ 1681e(b) and 1681s-2(a)(2)."
    ].join(" ");
  } else {
    fact = [
      `Alleged account: ${creditor}${last4}.`,
      `Equifax reports Field 24 as ${doaiLong || doai}.`,
      age != null
        ? `That is ${age} days before this Equifax file dated ${asOfLong}.`
        : `The Equifax file is dated ${asOfLong}.`,
      "Stale Field 24 data is incomplete Metro 2 reporting. The displayed balance and payment status may be wrong.",
      "Requested action: determine the correct Field 24 date through a reasonable reinvestigation, and correct or delete unverifiable data.",
      "Authority: 15 U.S.C. § 1681e(b); 15 U.S.C. § 1681i(a)(1)."
    ].join(" ");
  }
  return `${violationBanner(v)}\n${fact}`;
}

function personalItem(v, asOf, voice) {
  const label = v.subject || v.observed?.address || "a former address";
  const reportedOn = v.observed?.reportedOn;
  const months = v.observed?.monthsOld;
  const when = formatIsoLong(reportedOn) || reportedOn;
  const fact = voice === "EX"
    ? [
      `Experian still lists the former address ${label}, last reported ${when}.`,
      months != null ? `That is ${months} months before this report.` : "",
      "An old address that is no longer mine can attach another person's records to this file.",
      "Requested action: delete this former address. This is a supporting Metro 2 personal-information defect, not a tradeline wipe.",
      "Authority: 15 U.S.C. §§ 1681e(b) and 1681i(a)(1)."
    ].filter(Boolean).join(" ")
    : [
      `The file still carries the former address ${label}, last reported ${when}.`,
      months != null ? `That report is ${months} months old as of ${formatIsoLong(asOf)}.` : "",
      "Requested action: remove this outdated personal information.",
      "Authority: 15 U.S.C. §§ 1681e(b) and 1681i(a)(1)."
    ].filter(Boolean).join(" ");
  return `${violationBanner(v)}\n${fact}`;
}

function inquiryItem(v, voice) {
  const creditor = v.observed?.creditor || v.subject || "a creditor";
  const date = formatIsoLong(v.observed?.inquiryDate) || v.observed?.inquiryDate;
  const n = v.observed?.occurrence;
  const fact = voice === "EQ"
    ? [
      `Equifax reports ${creditor} as an inquiry more than once on ${date}.`,
      n ? `This letter challenges occurrence ${n} from that same day.` : "",
      "One application should produce one inquiry. Extra same-day entries overstate how often I sought credit.",
      "Requested action: delete the duplicate inquiry. This is a supporting Metro 2 inquiry defect.",
      "Authority: 15 U.S.C. §§ 1681b and 1681e(b)."
    ].filter(Boolean).join(" ")
    : [
      `${creditor} appears more than once as an inquiry on ${date}.`,
      "Requested action: delete the extra entry after a reasonable reinvestigation.",
      "Authority: 15 U.S.C. §§ 1681b and 1681e(b)."
    ].join(" ");
  return `${violationBanner(v)}\n${fact}`;
}

function numbered(items) {
  return items.map((p, i) => `${i + 1}. ${p}`).join("\n\n");
}

function buildDisputeLetter({ identity, bureau, items, asOf }) {
  const meta = BUREAU_META[bureau];
  const name = formatName(identity);
  const ag = attorneyGeneralFor(identity);
  const openings = {
    TU: "This is a Round 1 Metro 2 dispute. I dispute specific Field 24 defects on my TransUnion file and request a reasonable reinvestigation.",
    EX: "This is a Round 1 Metro 2 dispute of Experian reporting. The items below are Field 24 (Date of Account Information) defects that make the file incomplete or no longer current.",
    EQ: "This is a Round 1 Metro 2 dispute. Please reinvestigate the Equifax Field 24 dates named below. Each one is a concrete Metro 2 reporting defect on the file."
  };
  const thirty = {
    TU: "Please finish the reinvestigation within 30 days and send written results to the address above. With those results, provide the method of verification for each item, including the name, address, and telephone number of any furnisher you contacted. 15 U.S.C. § 1681i(a)(1); 15 U.S.C. § 1681i(a)(6)(B)(iii).",
    EX: "Experian must complete this reinvestigation within 30 days of receipt and send me the written results plus the method of verification used for each item. 15 U.S.C. § 1681i(a)(1); 15 U.S.C. § 1681i(a)(6)(B)(iii).",
    EQ: "Equifax has 30 days to complete a reasonable reinvestigation and to send written results, including the method of verification for every item you claim to have verified. 15 U.S.C. § 1681i(a)(1); 15 U.S.C. § 1681i(a)(6)(B)(iii)."
  };
  const escalate = [
    "These Field 24 findings are Moderate severity. The proper Round 1 ask is correction of the Metro 2 date, or deletion if the furnisher cannot verify current data. This is not a Round 3 willful-noncompliance notice.",
    `If you mark these items verified without a real investigation, or you fail to send the method of verification, the next letter is a Method of Verification demand under 15 U.S.C. § 1681i(a)(6)(B)(iii) and (a)(7), then a direct furnisher dispute under 12 C.F.R. § 1022.43.`,
    `If you do not complete a reasonable reinvestigation within 30 days, I will file a complaint with the Consumer Financial Protection Bureau and ${ag}, and I reserve all rights under 15 U.S.C. §§ 1681n and 1681o.`
  ].join(" ");
  const body = [
    openings[bureau],
    "",
    `This request is based on my ${meta.name} file dated ${formatIsoLong(asOf)}.`,
    "",
    numbered(items.map((v) => disputeItem(v, asOf, bureau))),
    "",
    "For each item, correct Field 24 or delete any information that cannot be verified. 15 U.S.C. § 1681i(a)(5)(A).",
    "",
    thirty[bureau],
    "",
    escalate,
    "",
    "This letter will be sent by certified mail, return receipt requested.",
    "",
    enclosures(),
    "",
    "Sincerely,",
    "",
    name
  ].join("\n");
  return [
    headerBlock({
      identity,
      bureau,
      asOf,
      subject: `Round 1 Metro 2 dispute — Violation M2-005, Field 24 — ${meta.name} file dated ${formatIsoLong(asOf)}`
    }),
    "",
    body
  ].join("\n");
}

function buildPersonalLetter({ identity, bureau, items, asOf }) {
  const meta = BUREAU_META[bureau];
  const name = formatName(identity);
  const opening = bureau === "EX"
    ? "This is a Round 1 Metro 2 personal-information dispute (M2-031). I request deletion of the outdated former addresses below. This is supporting severity, not a tradeline deletion demand."
    : `Please delete the outdated personal information listed below from my ${meta.name} file. Violation M2-031. Supporting severity.`;
  const body = [
    opening,
    "",
    numbered(items.map((v) => personalItem(v, asOf, bureau))),
    "",
    "Please complete this reinvestigation within 30 days and send written results. 15 U.S.C. § 1681i(a)(1).",
    "",
    "If these former addresses remain after 30 days, I will file a complaint with the Consumer Financial Protection Bureau and send a follow-up dispute. I am not treating this letter as a willful-noncompliance notice.",
    "",
    "This letter will be sent by certified mail, return receipt requested.",
    "",
    enclosures(),
    "",
    "Sincerely,",
    "",
    name
  ].join("\n");
  return [
    headerBlock({
      identity,
      bureau,
      asOf,
      subject: `Round 1 Metro 2 personal-information dispute — Violation M2-031 — ${meta.name}`
    }),
    "",
    body
  ].join("\n");
}

function buildInquiryLetter({ identity, bureau, items, asOf }) {
  const meta = BUREAU_META[bureau];
  const name = formatName(identity);
  const opening = bureau === "EQ"
    ? "This is a Round 1 Metro 2 inquiry dispute (M2-036). Equifax reports more than one inquiry from the same company on the same day. Those extra entries overstate how often I applied for credit. Supporting severity. Delete the duplicates. I am not claiming an unauthorized pull I cannot prove."
    : `Please delete the duplicate inquiries listed below from my ${meta.name} file. Violation M2-036. Supporting severity.`;
  const body = [
    opening,
    "",
    numbered(items.map((v) => inquiryItem(v, bureau))),
    "",
    "Please complete this reinvestigation within 30 days, delete unverifiable inquiries, and send written results. 15 U.S.C. §§ 1681e(b) and 1681i(a)(1).",
    "",
    "If the duplicates remain after 30 days, I will file a complaint with the Consumer Financial Protection Bureau. The next escalation after a rubber-stamp verify is a Method of Verification demand, not a damages lawsuit in this letter.",
    "",
    "This letter will be sent by certified mail, return receipt requested.",
    "",
    enclosures(),
    "",
    "Sincerely,",
    "",
    name
  ].join("\n");
  return [
    headerBlock({
      identity,
      bureau,
      asOf,
      subject: `Round 1 Metro 2 inquiry dispute — Violation M2-036 — ${meta.name} file dated ${formatIsoLong(asOf)}`
    }),
    "",
    body
  ].join("\n");
}

function assertNoBrand(text, filename) {
  if (/fundhub|FundHub|FUNDHUB/i.test(text)) {
    throw new Error(`brand leak in ${filename}`);
  }
}

function countsByRule(violations) {
  const m = {};
  for (const v of violations) {
    m[v.ruleId] = (m[v.ruleId] || 0) + 1;
  }
  return m;
}

async function main() {
  const cfgHint = createCrsClient({ env: process.env }).config;
  if (!cfgHint.configured) {
    throw new Error(`CRS not configured: ${cfgHint.missing.join(", ")}`);
  }
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    throw new Error("RESEND_API_KEY / RESEND_FROM missing");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const client = createCrsClient({ env: process.env });
  const letters = [];
  const summary = [];

  for (const bureau of BUREAUS) {
    if (ONLY_PERSONAL && bureau !== "EX") continue;
    const identity = identityForBureau({ host: client.host, bureau, env: process.env });
    const canned = SANDBOX_TEST_IDENTITIES[bureau];
    if (identity !== canned) throw new Error(`${bureau}: refused non-sandbox identity`);

    const pulled = await client.orderPrequal({ bureau, identity });
    if (!pulled.ok) {
      throw new Error(`${bureau} pull failed: ${pulled.blocked ? "adapters fence" : pulled.error}`);
    }

    const infileDate = reportAsOf(pulled.report);
    // Frozen sandbox files carry old infile dates (TU 2021, EQ 2002). Review them
    // as of the letter date so stale-date findings match a today-read of the file.
    const asOf = "2026-08-15";

    const { tradelines, context } = normalizeFromCrs(pulled.report, { asOf });
    const result = runReport(tradelines, context);
    if (result.errors?.length) {
      console.log(`${bureau} engine errors: ${result.errors.length}`);
    }

    const tradelineItems = result.tradelines.flatMap((row) =>
      (row.violations || []).map((v) => attachTradeline(v, row.tradeline))
    );
    const reportItems = result.report || [];
    const currentStreet = String(identity.addresses?.[0]?.addressLine1 || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    const personal = reportItems.filter((v) => {
      if (!PERSONAL_RULES.has(v.ruleId)) return false;
      const label = String(v.subject || v.observed?.address || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      // Do not dispute the current street as a "former" address.
      if (currentStreet && label.startsWith(currentStreet)) return false;
      return true;
    });
    const inquiries = reportItems.filter((v) => INQUIRY_RULES.has(v.ruleId));
    const stale = tradelineItems.filter((v) => v.ruleId === "M2-005");
    const otherTrade = tradelineItems.filter((v) => v.ruleId !== "M2-005");

    const disputeItems = [
      ...otherTrade,
      ...pickOldestStale(stale, Math.max(0, MAX_ITEMS - otherTrade.length))
    ].slice(0, MAX_ITEMS);
    const personalItems = personal.slice(0, MAX_ITEMS);
    const inquiryItems = pickStrongestInquiries(inquiries, MAX_ITEMS);

    const person = formatName(identity);
    summary.push({
      bureau,
      person,
      asOf,
      infileDate,
      tradelines: tradelines.length,
      engine: countsByRule(result.violations),
      disputeItems: disputeItems.length,
      personalItems: personalItems.length,
      inquiryItems: inquiryItems.length,
      requestIdPresent: Boolean(pulled.requestId)
    });

    const jobs = [];
    if (disputeItems.length && !ONLY_PERSONAL) {
      jobs.push({
        kind: "dispute",
        filename: `${person.replace(/\s+/g, "_")}_${BUREAU_META[bureau].name}_dispute.pdf`,
        text: buildDisputeLetter({ identity, bureau, items: disputeItems, asOf })
      });
    }
    if (personalItems.length) {
      jobs.push({
        kind: "personal_info",
        filename: `${person.replace(/\s+/g, "_")}_${BUREAU_META[bureau].name}_personal_info.pdf`,
        text: buildPersonalLetter({ identity, bureau, items: personalItems, asOf })
      });
    }
    if (inquiryItems.length && !ONLY_PERSONAL) {
      jobs.push({
        kind: "inquiry",
        filename: `${person.replace(/\s+/g, "_")}_${BUREAU_META[bureau].name}_inquiry.pdf`,
        text: buildInquiryLetter({ identity, bureau, items: inquiryItems, asOf })
      });
    }

    for (const job of jobs) {
      assertNoBrand(job.text, job.filename);
      const bytes = await renderLetterPdf({ text: job.text, identity: {} });
      const abs = path.join(OUT_DIR, job.filename);
      fs.writeFileSync(abs, bytes);
      letters.push({
        filename: job.filename,
        kind: job.kind,
        bureau,
        person,
        content: Buffer.from(bytes).toString("base64"),
        contentType: "application/pdf"
      });
    }
  }

  if (!letters.length) throw new Error("no letters produced");

  const cover = [
    "Sandbox dispute-letter sample pack",
    "",
    "These PDFs are for your review. Do not mail them to a bureau.",
    "No Fundhub name or logo is on the letters.",
    ONLY_PERSONAL
      ? "This replaces the Experian personal-info letter. Item 1 on the first version listed the current street as a former address. That item is gone."
      : "Inquiry phone scripts stay on hold. These are mail letters only.",
    "",
    "CRS sandbox is three canned people, not one tri-merge:",
    ...summary.map((s) => {
      const rules = Object.entries(s.engine).map(([k, n]) => `${k}×${n}`).join(", ") || "none";
      return `- ${s.person} / ${BUREAU_META[s.bureau].name} / infile ${s.infileDate} / reviewed ${s.asOf} / ${s.tradelines} accounts / engine ${rules} / letters: dispute ${s.disputeItems}, personal ${s.personalItems}, inquiry ${s.inquiryItems}`;
    }),
    "",
    "Every claim in a letter comes from the Metro 2 engine on the live sandbox pull.",
    "I capped each letter at five items. Stale-date findings are the oldest accounts, not every hit.",
    "TU and EQ sandbox files carry old infile dates. Stale-date letters use today's review date.",
    "A real client would still pull a fresh report before mailing.",
    "",
    "COMPLIANCE REVIEW REQUIRED before any live letter uses this wording."
  ].join("\n");

  const sent = await sendResend({
    to: TO,
    subject: ONLY_PERSONAL
      ? "Corrected Experian personal-info letter (drop item 1 from the first pack)"
      : "Sandbox letters v2 — Metro 2 violations labeled, Round 1 escalation",
    body: cover,
    attachments: letters.map((l) => ({
      filename: l.filename,
      content: l.content,
      contentType: l.contentType
    }))
  }, {
    env: {
      ...process.env,
      RESEND_FROM: "Fundhub <onboarding@resend.dev>"
    }
  });

  const out = {
    ok: sent.status === "sent",
    to: TO,
    providerStatus: sent.status,
    providerMessageId: sent.providerMessageId || null,
    letterCount: letters.length,
    files: letters.map((l) => l.filename),
    summary
  };
  if (sent.error) out.error = String(sent.error).slice(0, 200);
  console.log(JSON.stringify(out, null, 2));
  if (sent.status !== "sent") process.exit(1);
}

main().catch((err) => {
  console.error(String(err && err.message || err));
  process.exit(1);
});

// ============================================================================
// Dispute letter generator — gold layout (plain business letter, no branding)
// Matches docs/workflows/gold-deliverables-v5/LETTER_SPEC.md and
// fundhub_pdf_template.py render_letter() + css(plain=True).
// ============================================================================

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { logInfo } = require("./logger");
const { detectViolations } = require("./crs/metro2-violation-checker");

function pdfSafe(str) {
  if (str == null) return "";
  return String(str)
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/―/g, "\u2014")
    .replace(/…/g, "...")
    .replace(/[•●·]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014]/g, "");
}

function asInput(input) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function asPerson(personal) {
  return personal && typeof personal === "object" && !Array.isArray(personal) ? personal : {};
}

function asBureaus(bureaus) {
  return bureaus && typeof bureaus === "object" && !Array.isArray(bureaus) ? bureaus : {};
}

function asBureauFile(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asStringList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function asTradelines(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

function priorOutcomeOf(t) {
  return String((t && t.priorOutcome) || "").trim().toLowerCase();
}

const INK = rgb(12 / 255, 12 / 255, 13 / 255);
const BODY = rgb(38 / 255, 38 / 255, 42 / 255);
const CITE = rgb(110 / 255, 110 / 255, 118 / 255);
const RULE = rgb(231 / 255, 231 / 255, 234 / 255);

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_L = 52;
const MARGIN_R = 52;
const MARGIN_T = 58;
const MARGIN_B = 66;

const BUREAUS = {
  experian: {
    key: "experian",
    name: "Experian",
    legalName: "Experian",
    prefix: "ex",
    address: "P.O. Box 4500\nAllen, TX 75013"
  },
  transunion: {
    key: "transunion",
    name: "TransUnion",
    legalName: "TransUnion Consumer Solutions",
    prefix: "tu",
    address: "P.O. Box 2000\nChester, PA 19016"
  },
  equifax: {
    key: "equifax",
    name: "Equifax",
    legalName: "Equifax Information Services LLC",
    prefix: "eq",
    address: "P.O. Box 740256\nAtlanta, GA 30374"
  }
};

const EM = "\u2014";

const GOLD_FIELD_CODES = [
  "BALANCE_ON_CLOSED",
  "STALE_REPORTING",
  "COMPLIANCE_CODE_MISSING"
];

const GOLD_TITLES = {
  BALANCE_ON_CLOSED: "Non-Zero Balance on a Closed Account",
  STALE_REPORTING: "Stale Account Reporting",
  COMPLIANCE_CODE_MISSING: "Missing Compliance Condition Code on a Derogatory Account",
  DISPUTED_BUT_NO_NOTATION: "No Notation of Dispute"
};

const GOLD_CITES = {
  BALANCE_ON_CLOSED: "Metro 2 Field 21 (Current Balance)",
  STALE_REPORTING: "Metro 2 Field 24 (Date of Account Information)",
  COMPLIANCE_CODE_MISSING: "Metro 2 Field 20 (Compliance Condition Code)",
  DISPUTED_BUT_NO_NOTATION: "Metro 2 Field 20 (Compliance Condition Code)"
};

/**
 * Generate letters for a pack.
 * Suppression: if the item list for a bureau+type is empty, emit no letter.
 */
async function generateLetters(input = {}) {
  const { path, bureaus, personal, now } = asInput(input);
  const letters = [];
  const when = now || new Date();
  const data = asBureaus(bureaus);
  const who = asPerson(personal);

  if (path === "repair") {
    letters.push(...(await generateDisputeLetters({ bureaus: data, personal: who, now: when })));
  } else {
    letters.push(...(await generateInquiryLetters({ bureaus: data, personal: who, now: when })));
  }

  letters.push(...(await generatePersonalInfoLetters({ bureaus: data, personal: who, now: when })));

  logInfo("Letters generated", {
    path,
    count: letters.length,
    files: letters.map(l => l.filename)
  });

  return letters;
}

async function generateDisputeLetters(input = {}) {
  const { bureaus, personal, now } = asInput(input);
  const letters = [];
  const data = asBureaus(bureaus);
  const who = asPerson(personal);
  const when = now || new Date();

  for (const [bureauKey, bureauInfo] of Object.entries(BUREAUS)) {
    const bureauData = asBureauFile(data[bureauKey]);
    for (const round of [1, 2, 3]) {
      const accounts = getAccountsForRound(bureauData, round);
      if (!accounts.length) continue;

      const buffer = await createDisputeLetter({
        bureau: bureauInfo,
        personal: who,
        round,
        accounts,
        now: when
      });

      letters.push({
        filename: `${bureauInfo.prefix}_round${round}.pdf`,
        buffer,
        type: "dispute",
        bureau: bureauKey,
        round
      });
    }
  }

  return letters;
}

async function generateInquiryLetters(input = {}) {
  const { bureaus, personal, now } = asInput(input);
  const letters = [];
  const data = asBureaus(bureaus);
  const who = asPerson(personal);
  const when = now || new Date();

  for (const [bureauKey, bureauInfo] of Object.entries(BUREAUS)) {
    const items = collectInquiryItems(asBureauFile(data[bureauKey]));
    if (!items.length) continue;

    const buffer = await createInquiryLetter({
      bureau: bureauInfo,
      personal: who,
      items,
      now: when
    });

    letters.push({
      filename: `inquiry_${bureauInfo.prefix}.pdf`,
      buffer,
      type: "inquiry_removal",
      bureau: bureauKey
    });
  }

  return letters;
}

async function generatePersonalInfoLetters(input = {}) {
  const { bureaus, personal, now } = asInput(input);
  const letters = [];
  const data = asBureaus(bureaus);
  const who = asPerson(personal);
  const when = now || new Date();

  for (const [bureauKey, bureauInfo] of Object.entries(BUREAUS)) {
    const items = collectPersonalInfoItems(bureauKey, data, who);
    if (!items.length) continue;

    const buffer = await createPersonalInfoLetter({
      bureau: bureauInfo,
      personal: who,
      items,
      now: when
    });

    letters.push({
      filename: `personal_info_${bureauInfo.prefix}.pdf`,
      buffer,
      type: "personal_info",
      bureau: bureauKey
    });
  }

  return letters;
}

function getAccountsForRound(bureauData, round) {
  const tradelines = asTradelines(bureauData && bureauData.tradelines);
  const negative = tradelines.filter(isDerogatoryAccount);
  const withFields = negative
    .map(t => ({ tradeline: t, fields: fieldDisputesFor(t) }))
    .filter(row => row.fields.length > 0);

  if (round === 1) {
    return withFields.filter(row => {
      const outcome = priorOutcomeOf(row.tradeline);
      return !outcome || outcome === "pending" || outcome === "round1";
    });
  }

  // Rounds 2 and 3 only for items that came back verified. No outcome capture
  // UI — callers may pass priorOutcome on the tradeline when they have it.
  const need = round === 2 ? "verified" : "verified_round2";
  return withFields.filter(row => priorOutcomeOf(row.tradeline) === need);
}

function isDerogatoryAccount(t) {
  if (!t) return false;
  if (t.isDerogatory || t.is_negative) return true;
  const status = String(t.status || "").toLowerCase();
  const rating = String(t.currentRatingType || "").toLowerCase();
  return (
    status.includes("collection") ||
    status.includes("charge") ||
    /\blate/.test(status) ||
    rating.includes("charge") ||
    rating.includes("collection") ||
    rating.includes("late")
  );
}

function toCheckerTradeline(t) {
  return {
    creditorName: t.creditorName || t.creditor || null,
    accountIdentifier: t.accountIdentifier || t.account_id || null,
    status: t.status || null,
    currentBalance: numOrNull(t.currentBalance ?? t.balance),
    pastDue: numOrNull(t.pastDue ?? t.past_due),
    reportedDate: t.reportedDate || t.dateReported || t.reported_date || null,
    openedDate: t.openedDate || t.dateOpened || null,
    closedDate: t.closedDate || t.dateClosed || null,
    isDerogatory: !!(t.isDerogatory || t.is_negative),
    accountType: t.accountType != null ? t.accountType : null,
    comments: Array.isArray(t.comments) ? t.comments : [],
    currentRatingType: t.currentRatingType || null,
    chargeOffAmount: numOrNull(t.chargeOffAmount),
    complianceConditionCode: t.complianceConditionCode || null,
    inferredDofd: t.inferredDofd || t.dofd || null,
    ownership: t.ownership || null,
    isAU: !!t.isAU
  };
}

function fieldDisputesFor(t) {
  const { violations } = detectViolations(toCheckerTradeline(t));
  const all = (violations || []).filter(Boolean);
  const gold = GOLD_FIELD_CODES.map(code => all.find(v => v.code === code)).filter(Boolean);
  if (gold.length) return gold;
  const extra = all.filter(
    v => (v.severity === "high" || v.severity === "medium") && v.code !== "MISSING_ACCOUNT_TYPE"
  );
  if (extra.length) return extra;
  if (isDerogatoryAccount(t)) {
    return [
      {
        code: "COMPLIANCE_CODE_MISSING",
        field: "Field 20 (Compliance Condition Code)",
        expected: "Derogatory accounts should carry an applicable compliance condition code",
        actual: "No compliance condition code found in account comments",
        severity: "low",
        statute: "FCRA §1681s-2(a)(3)",
        explanation:
          "This account is reported as derogatory, yet Field 20 has no Compliance Condition Code. Metro 2 requires that code on adverse accounts. Please investigate and correct or delete the item."
      }
    ];
  }
  return [];
}

function collectInquiryItems(bureauData) {
  const raw = listInquiries(bureauData);
  if (!raw.length) return [];
  const openNames = asTradelines(bureauData && bureauData.tradelines)
    .filter(t => {
      const status = String(t.status || "").toLowerCase();
      if (status === "closed" || status === "paid" || status === "transferred") return false;
      return !t.closedDate && !t.dateClosed;
    })
    .map(t => normToken(t.creditorName || t.creditor));

  return raw.filter(inq => {
    const name = inq.creditorName || inq.creditor || inq.name;
    if (!String(name || "").trim()) return false;
    const token = normToken(name);
    if (!token) return false;
    return !openNames.some(open => open && (open.includes(token) || token.includes(open)));
  });
}

function listInquiries(bureauData) {
  if (Array.isArray(bureauData && bureauData.inquiries)) {
    return bureauData.inquiries.filter(Boolean);
  }
  if (Array.isArray(bureauData && bureauData.inquiryList)) {
    return bureauData.inquiryList.filter(Boolean);
  }
  return [];
}

function collectPersonalInfoItems(bureauKey, bureaus, personal) {
  const data = asBureaus(bureaus);
  const mine = asBureauFile(data[bureauKey]);
  const who = asPerson(personal);
  const namesRaw = asStringList(mine.names);
  const addressesRaw = asStringList(mine.addresses);
  const employersRaw = asStringList(mine.employers);
  const ssnsRaw = asStringList(mine.ssns);
  const dobsRaw = asStringList(mine.dobs);
  const hasFile =
    namesRaw.length ||
    addressesRaw.length ||
    employersRaw.length ||
    ssnsRaw.length ||
    dobsRaw.length;
  if (!hasFile) return [];
  const legalName = String(who.name || "").trim();
  const currentAddress = currentAddressLine(who);
  const currentEmployer = String(who.employer || who.currentEmployer || "").trim();
  const currentDob = String(who.dob || who.dateOfBirth || "").trim();
  const currentSsnLast4 = last4(who.ssn);

  const items = [];

  const names = uniqueStrings(namesRaw.map(formatName).filter(Boolean));
  const extraNames = names.filter(n => legalName && !sameToken(n, legalName));
  if (extraNames.length) {
    items.push({
      heading: "NAME VARIATIONS",
      lines: extraNames.map(n => `The file shows ${n}.`),
      fix: legalName
        ? `Please keep only my legal name: ${legalName}. Remove every other name.`
        : "Please keep only my legal name. Remove every other name."
    });
  }

  const ssns = ssnsRaw.map(formatSsnRecord).filter(s => s.last4);
  const otherLast4 = uniqueStrings(
    ssns.map(s => s.last4).filter(l4 => !currentSsnLast4 || l4 !== currentSsnLast4)
  );
  if (ssns.length > 1 || otherLast4.length) {
    items.push({
      heading: "SOCIAL SECURITY NUMBER",
      lines: [
        ssns.length > 1
          ? "This file shows more than one Social Security number."
          : `This file shows a Social Security number ending in ${otherLast4[0]}.`
      ],
      fix: currentSsnLast4
        ? `Please keep only the number that ends in ${currentSsnLast4}. Remove the other.`
        : "Please keep only the number that matches my legal identity. Remove the other."
    });
  }

  const addresses = uniqueStrings(addressesRaw.map(formatAddress).filter(Boolean));
  const extraAddresses = addresses.filter(a => !currentAddress || !sameToken(a, currentAddress));
  if (extraAddresses.length) {
    items.push({
      heading: "ADDRESSES",
      lines: extraAddresses.map(a => a),
      fix: currentAddress
        ? `Please keep only this address: ${currentAddress}. Remove the addresses listed above.`
        : "Please keep only my current address. Remove the old addresses listed above."
    });
  }

  const employers = uniqueStrings(employersRaw.map(formatEmployer).filter(Boolean));
  const extraEmployers = employers.filter(e => !currentEmployer || !sameToken(e, currentEmployer));
  if (extraEmployers.length) {
    items.push({
      heading: "EMPLOYERS",
      lines: extraEmployers.map(e => e),
      fix: currentEmployer
        ? `Please keep only my current employer: ${currentEmployer}. Remove the others.`
        : "Please keep only my current employer. Remove the others listed above."
    });
  }

  const myDobs = uniqueStrings(dobsRaw.map(formatDob).filter(Boolean));
  const otherBureauHasDob = Object.entries(data).some(([key, b]) => {
    if (key === bureauKey) return false;
    return asStringList(asBureauFile(b).dobs).map(formatDob).some(Boolean);
  });
  if (!myDobs.length && (currentDob || otherBureauHasDob)) {
    items.push({
      heading: "DATE OF BIRTH",
      lines: ["This file is missing my date of birth."],
      fix: "Please add the date of birth that matches my government ID so all three bureaus match."
    });
  } else if (currentDob && myDobs.some(d => !sameToken(d, currentDob))) {
    items.push({
      heading: "DATE OF BIRTH",
      lines: myDobs.map(d => `The file shows ${d}.`),
      fix: "Please correct my date of birth so it matches my government ID on all three bureaus."
    });
  }

  return items;
}

async function createDisputeLetter({ bureau, personal, round, accounts, now }) {
  const who = senderLines(personal);
  const date = formatLetterDate(now);
  const first = accounts[0] && accounts[0].tradeline;
  const creditor = (first && (first.creditorName || first.creditor)) || "Unknown creditor";
  const last4id = last4((first && (first.accountIdentifier || first.account_id)) || "");
  const many = accounts.length > 1;
  const re = many
    ? `RE: Formal Dispute ${EM} Inaccurate Information on My ${bureau.name} Credit File`
    : `RE: Formal Dispute ${EM} ${creditor} | Account Ending in ${last4id || "XXXX"}`;

  const greeting = disputeGreeting(bureau);
  const intro = disputeIntro(bureau, round, accounts);
  const body = [{ t: "p", text: greeting }, { t: "p", text: intro }];

  let n = 0;
  for (const row of accounts) {
    const tl = row.tradeline;
    const name = tl.creditorName || tl.creditor || "Unknown creditor";
    const acct = last4(tl.accountIdentifier || tl.account_id || "");
    if (many) {
      body.push({
        t: "item",
        text: `ACCOUNT - ${name}${acct ? ` | ending in ${acct}` : ""}`
      });
    }
    for (const v of row.fields) {
      n += 1;
      body.push({ t: "item", text: `DISPUTE ITEM ${n} ${EM} ${disputeTitle(v)}` });
      body.push({ t: "cite", text: `${metroCite(v)} | ${fcraCite(v)}` });
      body.push({ t: "p", text: disputeExplanation(v, tl, bureau, now) });
    }
  }

  body.push({ t: "item", text: "REQUESTED ACTIONS" });
  body.push({
    t: "p",
    text: `I am asking ${bureau.name} to take the following steps:`
  });
  body.push({ t: "ol", items: requestedActions(bureau, round, accounts) });
  const furnish = many ? "a furnisher" : creditor;
  body.push({
    t: "p",
    text:
      `If ${furnish} cannot verify the accuracy of each specific data point identified above, ` +
      "FCRA § 1681i(a)(5)(A) requires that the item be promptly deleted or corrected."
  });
  if (round >= 2) {
    body.push({ t: "p", text: roundEscalationNote(round) });
  }

  return renderPlainLetter({
    title: re,
    date,
    sender: who,
    recipient: recipientLines(bureau),
    re,
    body,
    sig: who,
    enclosures: disputeEnclosures(accounts)
  });
}

async function createInquiryLetter({ bureau, personal, items, now }) {
  const who = senderLines(personal);
  const date = formatLetterDate(now);
  const re = "Re: Inquiry Removal Request";
  const body = [
    { t: "p", text: "To Whom It May Concern," },
    {
      t: "p",
      text:
        `I did not allow these hard pulls on my ${bureau.name} credit file. ` +
        "A company may pull my credit only when the law allows it. That rule is " +
        "FCRA section 604 (15 U.S.C. 1681b)."
    },
    {
      t: "p",
      text:
        "Please look at each inquiry below. None of them match an open account I applied for with that company. " +
        "If you cannot show a legal reason for the pull, delete it within 30 days."
    }
  ];

  items.forEach((inq, idx) => {
    const name = inq.creditorName || inq.creditor || inq.name || "Unknown inquirer";
    body.push({ t: "item", text: `INQUIRY ${idx + 1} - ${name}` });
    const when = formatInquiryDate(inq.date || inq.inquiryDate);
    body.push({ t: "cite", text: when ? `Date: ${when}` : "Date: not reported" });
  });

  body.push({
    t: "p",
    text:
      "Please investigate each inquiry under FCRA section 611 (15 U.S.C. 1681i). " +
      "Send me the written results when you are done."
  });

  return renderPlainLetter({
    title: re,
    date,
    sender: who,
    recipient: recipientLines(bureau),
    re,
    body,
    sig: who,
    enclosures: [
      "Copy of government-issued photo ID",
      "Copy of proof of address (utility bill or bank statement)",
      `Copy of ${bureau.name} credit report with the listed inquiries highlighted`
    ]
  });
}

async function createPersonalInfoLetter({ bureau, personal, items, now }) {
  const who = senderLines(personal);
  const date = formatLetterDate(now);
  const re = "Re: Personal Information Correction Request";
  const body = [
    { t: "p", text: "To Whom It May Concern," },
    {
      t: "p",
      text:
        `My ${bureau.name} file has personal facts that are wrong. Under FCRA section 611 ` +
        "(15 U.S.C. 1681i), you must look into this and fix it within 30 days."
    },
    {
      t: "p",
      text: "Keep only the facts that match me. Remove the rest."
    }
  ];

  for (const item of items) {
    body.push({ t: "item", text: item.heading });
    for (const line of item.lines || []) {
      body.push({ t: "p", text: line });
    }
    if (item.fix) body.push({ t: "p", text: item.fix });
  }

  body.push({
    t: "p",
    text: "Please send me written results and an updated copy of my file when this is done."
  });

  return renderPlainLetter({
    title: re,
    date,
    sender: who,
    recipient: recipientLines(bureau),
    re,
    body,
    sig: who,
    enclosures: [
      "Copy of government-issued photo ID",
      "Copy of proof of address (utility bill or bank statement)",
      `Copy of ${bureau.name} credit report showing the personal information to correct`
    ]
  });
}

function disputeGreeting(bureau) {
  if (bureau.key === "equifax") return "Dear Equifax Dispute Department,";
  if (bureau.key === "transunion") return "Dear TransUnion Dispute Department,";
  return "To Whom It May Concern,";
}

function disputeIntro(bureau, round, accounts) {
  const first = accounts[0].tradeline;
  const creditor = first.creditorName || first.creditor || "the listed creditor";
  const last4id = last4(first.accountIdentifier || first.account_id || "");
  const many = accounts.length > 1;
  const roundBit =
    round === 1
      ? ""
      : round === 2
        ? " This is my Round 2 letter. I already asked you to investigate. The item came back verified. An automated e-OSCAR match is not a real reinvestigation."
        : " This is my Round 3 letter. Two earlier disputes did not fix the file. I am also sending a complaint to the CFPB and a direct dispute to the furnisher.";

  if (many) {
    return (
      `I am writing to dispute inaccurate and incomplete information on my ${bureau.name} credit report. ` +
      `This letter covers ${accounts.length} accounts. I ask for a full reinvestigation under ` +
      `FCRA § 1681i(a)(1)(A). You must finish this within 30 days of getting this letter. ` +
      `Each Metro 2 field violation is listed below.${roundBit}`
    );
  }

  return (
    `I am writing to formally dispute inaccurate and incomplete information appearing on my ${bureau.name} credit report. ` +
    `The account in question is reported by ${creditor}` +
    (last4id ? `, ending in ${last4id}` : "") +
    `. After reviewing my credit file, I have identified multiple Metro 2 reporting violations that make this account's current reporting inaccurate. ` +
    `I am requesting a full reinvestigation under FCRA § 1681i(a)(1)(A), which requires ${bureau.name} to complete this investigation within 30 days of receipt of this letter. ` +
    `Each violation is detailed separately below.${roundBit}`
  );
}

function disputeTitle(v) {
  return GOLD_TITLES[v.code] || v.expected || v.code || "Inaccurate Metro 2 field";
}

function metroCite(v) {
  if (GOLD_CITES[v.code]) return GOLD_CITES[v.code];
  const field = String(v.field || "Metro 2 field").trim();
  if (/^metro\s*2/i.test(field)) return field;
  return `Metro 2 ${field}`;
}

function fcraCite(v) {
  const s = String(v.statute || "FCRA §1681i");
  return s.replace(/§\s*/g, "§ ");
}

function disputeExplanation(v, tl, bureau, now) {
  const balance = money(tl.currentBalance ?? tl.balance);
  const reported = formatInquiryDate(tl.reportedDate || tl.dateReported);
  const days = staleDays(tl.reportedDate || tl.dateReported, now);
  const pastDue = money(tl.pastDue ?? tl.past_due);
  const creditor = tl.creditorName || tl.creditor || "the furnisher";
  const rating = String(tl.currentRatingType || tl.status || "").toLowerCase();
  const chargeOff = /charge/.test(rating);

  if (v.code === "BALANCE_ON_CLOSED") {
    return (
      `This account is reported as closed, yet Field 21 shows a current balance of ${balance || "more than $0"}. ` +
      `Under Metro 2 standards, a closed account must report a $0 balance in Field 21. These two data points directly contradict each other. ` +
      `Either the account is closed and the balance should be $0, or the balance is still active and the status is wrong. Both cannot be true at the same time. ` +
      `Reporting a ${balance || "non-zero"} balance on a closed account is inaccurate under FCRA § 1681s-2(a)(1)(A), which prohibits furnishing information that a person knows or has reasonable cause to believe is inaccurate. ` +
      `I am requesting that ${bureau.name} investigate this contradiction and correct Field 21 to reflect an accurate balance consistent with the reported account status.`
    );
  }
  if (v.code === "STALE_REPORTING") {
    const age =
      days == null
        ? ""
        : days / 365.25 >= 4.4 && days / 365.25 < 5.6
          ? ` ${EM} nearly five years ago`
          : ` ${EM} ${days.toLocaleString("en-US")} days ago`;
    const since = monthYear(tl.reportedDate || tl.dateReported);
    const dayCount = days != null ? days.toLocaleString("en-US") : null;
    return (
      `The last reported date for this account is ${reported || "not current"}${age}. ` +
      `Field 24, the Date of Account Information, is required to reflect a current reporting cycle. ` +
      (dayCount
        ? `An account that has not been updated in over ${dayCount} days does not meet that standard. `
        : "") +
      `FCRA § 1681s-2(a)(2) requires furnishers to correct and update information to ensure it remains accurate. ` +
      `Stale data in Field 24 means the information being reported may no longer reflect the true status of this account, which creates a misleading picture of my credit history. ` +
      `I am requesting that ${bureau.name} verify whether ${creditor} has provided any updated account information` +
      (since ? ` since ${since}` : "") +
      `, and take appropriate action if no current data can be confirmed.`
    );
  }
  if (v.code === "COMPLIANCE_CODE_MISSING") {
    const lead = chargeOff
      ? "This account carries a charge-off rating and is flagged as derogatory, yet Field 20 contains no Compliance Condition Code whatsoever. "
      : `This account carries adverse information${pastDue ? ` with a past-due balance of ${pastDue}` : ""}, yet Field 20 contains no Compliance Condition Code. `;
    return (
      lead +
      "Metro 2 guidelines require furnishers to populate Field 20 with the applicable code that reflects the account's legal and compliance standing. " +
      "The complete absence of any code on an account with adverse information is a reporting omission. " +
      "Under FCRA § 1681s-2(a)(3), furnishers are required to note when information is disputed, and more broadly, to report complete and accurate data. " +
      "A missing Compliance Condition Code on a derogatory account leaves the reporting incomplete. " +
      `I am requesting that ${bureau.name} contact ${creditor} to determine what Compliance Condition Code, if any, should be applied to this account, and update the file accordingly.`
    );
  }
  if (v.code === "DISPUTED_BUT_NO_NOTATION") {
    return (
      `This tradeline contains no notation that the account is disputed by the consumer. ` +
      `FCRA § 1681s-2(a)(3) requires furnishers to note a consumer's dispute when reporting information to the bureaus. ` +
      `Please mark the account as disputed and investigate the Metro 2 fields in this letter.`
    );
  }
  return String(v.explanation || v.expected || "This field is inaccurate. Please investigate and correct or delete it.");
}

function requestedActions(bureau, round, accounts) {
  const first = accounts[0].tradeline;
  const creditor = first.creditorName || first.creditor || "the furnisher";
  const last4id = last4(first.accountIdentifier || first.account_id || "");
  const target = accounts.length > 1 ? "each account listed above" : `the ${creditor} account${last4id ? ` ending in ${last4id}` : ""}`;
  const deadline = round === 1 ? "30 days" : "15 days";

  const contact =
    accounts.length > 1
      ? "Contact the furnishers listed above and provide them with all relevant information included in this dispute."
      : `Contact ${creditor} and provide them with all relevant information included in this dispute.`;
  const actions = [
    `Conduct a full reinvestigation of ${target} within ${deadline} as required by FCRA § 1681i(a)(1)(A).`,
    contact,
    "Correct or delete any information that cannot be verified as accurate and complete.",
    `Upon completion of the investigation, provide me with written results, an updated copy of my credit report, and ${EM} pursuant to FCRA § 1681i(a)(6)(B)(iii) ${EM} a full description of the method of verification used, including the name, address, and telephone number of any furnisher contacted during the process.`
  ];
  if (round >= 2) {
    actions.push(
      "A verification that consists solely of an automated e-OSCAR match does not satisfy the reinvestigation requirements of FCRA § 1681i."
    );
  }
  if (round >= 3) {
    actions.push(
      "If any statutory deadline was missed, treat this as a procedural failure and delete the unverified item. I am filing a CFPB complaint and a direct dispute with the original furnisher alongside this letter."
    );
  }
  return actions;
}

function roundEscalationNote(round) {
  if (round === 2) {
    return "If this account is verified, I am formally requesting the method of verification used, including the name, address, and telephone number of the furnisher contact who verified the information, and copies of any documents relied upon.";
  }
  return "If the file is still wrong after this letter, I will pursue the remedies available to me under the FCRA, including a CFPB complaint.";
}

function disputeEnclosures(accounts) {
  const first = accounts[0].tradeline;
  const last4id = last4((first && (first.accountIdentifier || first.account_id)) || "");
  const highlight =
    accounts.length > 1
      ? "Copy of credit report with the disputed accounts highlighted"
      : `Copy of credit report with account ending in ${last4id || "XXXX"} highlighted`;
  return [
    "Copy of government-issued photo ID",
    "Copy of proof of address (utility bill or bank statement)",
    highlight
  ];
}

function senderLines(personal) {
  const name = String((personal && personal.name) || "Client").trim() || "Client";
  const lines = [name];
  const addr = personal && personal.address;
  if (Array.isArray(personal && personal.addressLines) && personal.addressLines.length) {
    personal.addressLines.filter(Boolean).forEach(l => lines.push(String(l).trim()));
  } else if (addr) {
    String(addr)
      .split(/\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .forEach(l => lines.push(l));
  }
  const city = personal && (personal.city || personal.state || personal.zip)
    ? [personal.city, [personal.state, personal.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : "";
  if (city && !lines.some(l => sameToken(l, city))) lines.push(city);
  return lines;
}

function recipientLines(bureau) {
  return [bureau.legalName || bureau.name, ...String(bureau.address || "").split("\n")];
}

function currentAddressLine(personal) {
  if (!personal) return "";
  if (personal.address) {
    return String(personal.address)
      .split(/\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .join(", ");
  }
  return [personal.city, personal.state, personal.zip].filter(Boolean).join(", ");
}

function formatName(n) {
  if (n == null) return "";
  if (typeof n === "string") return n.trim();
  return [n.first, n.middle, n.last, n.name].filter(Boolean).join(" ").trim();
}

function formatAddress(a) {
  if (a == null) return "";
  if (typeof a === "string") return a.trim();
  const cityState = [a.city, [a.state, a.zip || a.postalCode || a.zipFull].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [a.line1 || a.addressLine1, a.line2 || a.addressLine2, cityState].filter(Boolean).join(", ");
}

function formatEmployer(e) {
  if (e == null) return "";
  if (typeof e === "string") return e.trim();
  return String(e.name || e.employerName || "").trim();
}

function formatDob(d) {
  if (d == null) return "";
  if (typeof d === "string") return d.trim();
  return String(d.value || d.dob || "").trim();
}

function formatSsnRecord(s) {
  if (s == null) return { last4: "" };
  if (typeof s === "string") return { last4: last4(s) };
  return { last4: last4(s.value || s.ssn || "") };
}

function last4(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  return digits.slice(-4);
}

function formatLetterDate(now) {
  const d = now instanceof Date ? now : now ? new Date(now) : new Date();
  if (Number.isNaN(d.getTime())) {
    return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatInquiryDate(value) {
  if (!value) return "";
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function staleDays(reported, now) {
  if (!reported) return null;
  const d = new Date(String(reported).length === 10 ? `${reported}T00:00:00Z` : reported);
  if (Number.isNaN(d.getTime())) return null;
  const end = now instanceof Date ? now : now ? new Date(now) : new Date();
  if (Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.floor((end.getTime() - d.getTime()) / 86400000));
}

function monthYear(value) {
  if (!value) return "";
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", timeZone: "UTC" });
}

function money(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  return "$" + Math.round(num).toLocaleString("en-US");
}

function numOrNull(n) {
  if (n == null || n === "") return null;
  const num = Number(n);
  return Number.isFinite(num) ? num : null;
}

function normToken(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function sameToken(a, b) {
  const x = normToken(a);
  const y = normToken(b);
  return !!x && x === y;
}

function uniqueStrings(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    const t = String(s || "").trim();
    if (!t) continue;
    const key = normToken(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function wrapText(text, font, size, maxWidth, tracking = 0) {
  const safe = pdfSafe(text);
  const words = safe.split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const widthOf = s => {
    const w = font.widthOfTextAtSize(s, size);
    return tracking ? w + tracking * Math.max(0, s.length - 1) : w;
  };
  let line = "";
  const lines = [];
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (widthOf(test) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      if (widthOf(word) <= maxWidth) {
        line = word;
      } else {
        let chunk = "";
        for (const ch of word) {
          const next = chunk + ch;
          if (widthOf(next) <= maxWidth) chunk = next;
          else {
            if (chunk) lines.push(chunk);
            chunk = ch;
          }
        }
        line = chunk;
      }
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

async function renderPlainLetter(spec) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdfDoc.embedFont(StandardFonts.Courier);
  const monoBold = await pdfDoc.embedFont(StandardFonts.CourierBold);
  try {
    pdfDoc.setTitle(pdfSafe(spec.title || spec.re || "Letter"));
    pdfDoc.setAuthor("");
    pdfDoc.setSubject("");
    pdfDoc.setCreator("");
    pdfDoc.setProducer("");
  } catch (_err) {
    // metadata is best-effort; letters must not carry Fundhub as author
  }

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN_T;
  const maxWidth = PAGE_W - MARGIN_L - MARGIN_R;
  const BODY_SIZE = 9.6;
  const BODY_LEADING = BODY_SIZE * 1.66;
  const ADDR_LEADING = 9.5 * 1.5;

  function ensure(h) {
    if (y - h < MARGIN_B) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN_T;
    }
  }

  function gap(pt) {
    y -= pt;
  }

  function drawParagraph(text, { size = BODY_SIZE, face = font, color = BODY, leading = BODY_LEADING, after = 10 } = {}) {
    const wrapped = wrapText(text, face, size, maxWidth).split("\n");
    for (const line of wrapped) {
      if (!line) continue;
      ensure(leading);
      page.drawText(line, { x: MARGIN_L, y, size, font: face, color });
      y -= leading;
    }
    if (after) y -= after;
  }

  function drawTrackedLine(text, { size, face, color, tracking, leading, after = 0 }) {
    const wrapped = wrapText(text, face, size, maxWidth, tracking).split("\n");
    for (const line of wrapped) {
      if (!line) continue;
      ensure(leading);
      let x = MARGIN_L;
      const chars = pdfSafe(line).split("");
      for (const ch of chars) {
        page.drawText(ch, { x, y, size, font: face, color });
        x += face.widthOfTextAtSize(ch, size) + tracking;
      }
      y -= leading;
    }
    if (after) y -= after;
  }

  for (const line of spec.sender || []) {
    drawParagraph(line, { size: 9.5, face: font, color: BODY, leading: ADDR_LEADING, after: 0 });
  }
  gap(16);

  drawParagraph(spec.date, { size: 9.5, color: BODY, leading: ADDR_LEADING, after: 16 });

  (spec.recipient || []).forEach((line, i) => {
    drawParagraph(line, {
      size: 9.5,
      face: i === 0 ? bold : font,
      color: i === 0 ? INK : BODY,
      leading: ADDR_LEADING,
      after: 0
    });
  });
  gap(16);

  drawParagraph(spec.re, { size: 9.8, face: bold, color: INK, leading: 14, after: 16 });

  for (const block of spec.body || []) {
    const t = block.t;
    if (t === "p") {
      drawParagraph(block.text, { size: BODY_SIZE, color: BODY, leading: BODY_LEADING, after: 10 });
    } else if (t === "item") {
      gap(15);
      drawParagraph(block.text, { size: 9.9, face: bold, color: INK, leading: 14, after: 3 });
    } else if (t === "cite") {
      drawParagraph(block.text, {
        size: 7.3,
        face: mono,
        color: CITE,
        leading: 11,
        after: 7
      });
    } else if (t === "ol") {
      (block.items || []).forEach((item, idx) => {
        const num = String(idx + 1);
        const indent = 19;
        const wrapped = wrapText(item, font, 9.3, maxWidth - indent).split("\n");
        wrapped.forEach((line, li) => {
          ensure(14);
          if (li === 0) {
            page.drawText(num, { x: MARGIN_L, y, size: 8, font: monoBold, color: INK });
          }
          page.drawText(line, { x: MARGIN_L + indent, y, size: 9.3, font, color: BODY });
          y -= 14;
        });
        y -= 5;
      });
      gap(8);
    } else if (t === "ul") {
      for (const item of block.items || []) {
        const wrapped = wrapText(item, font, 9.3, maxWidth - 13).split("\n");
        wrapped.forEach((line, li) => {
          ensure(14);
          if (li === 0) {
            page.drawRectangle({
              x: MARGIN_L,
              y: y + 2,
              width: 3.2,
              height: 3.2,
              color: INK
            });
          }
          page.drawText(line, { x: MARGIN_L + 13, y, size: 9.3, font, color: BODY });
          y -= 14;
        });
      }
      gap(8);
    }
  }

  if (spec.sig && spec.sig.length) {
    gap(20);
    drawParagraph("Sincerely,", { size: BODY_SIZE, color: BODY, leading: BODY_LEADING, after: 28 });
    spec.sig.forEach((line, i) => {
      drawParagraph(line, {
        size: BODY_SIZE,
        face: i === 0 ? bold : font,
        color: i === 0 ? INK : BODY,
        leading: BODY_SIZE * 1.6,
        after: 0
      });
    });
  }

  if (spec.enclosures && spec.enclosures.length) {
    gap(18);
    ensure(20);
    page.drawLine({
      start: { x: MARGIN_L, y: y + 8 },
      end: { x: PAGE_W - MARGIN_R, y: y + 8 },
      thickness: 0.7,
      color: RULE
    });
    gap(10);
    drawTrackedLine("ENCLOSURES", {
      size: 6.8,
      face: mono,
      color: CITE,
      tracking: 1.4,
      leading: 12,
      after: 6
    });
    for (const item of spec.enclosures) {
      const wrapped = wrapText(item, font, 9.3, maxWidth - 13).split("\n");
      wrapped.forEach((line, li) => {
        ensure(14);
        if (li === 0) {
          page.drawRectangle({
            x: MARGIN_L,
            y: y + 2,
            width: 3.2,
            height: 3.2,
            color: INK
          });
        }
        page.drawText(line, { x: MARGIN_L + 13, y, size: 9.3, font, color: BODY });
        y -= 14;
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = {
  generateLetters,
  generateDisputeLetters,
  generateInquiryLetters,
  generatePersonalInfoLetters,
  collectInquiryItems,
  collectPersonalInfoItems,
  getAccountsForRound,
  BUREAUS
};

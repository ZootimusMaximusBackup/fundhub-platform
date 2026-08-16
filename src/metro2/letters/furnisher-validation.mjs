// FDCPA § 809(b) debt-validation letter, sent direct to a collector/furnisher.
// Separate from the Metro 2 / FCRA furnisher dispute in generate.mjs (ROUND.FURNISHER).
// No Fundhub brand. No invented Metro 2 field numbers.

import { LETTER_TYPES } from "./catalog.mjs";
import { handwrittenSignOff } from "./sign-block.mjs";
import { renderLetterPdf } from "./render.mjs";

const COVER =
  "Send this if you are still inside the 30-day validation window from the collector's first contact. If that window has passed, use the bureau/furnisher FCRA dispute instead.";

function last4Only(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "xxxx";
  return digits.slice(-4);
}

function formatAsOf(asOf) {
  const raw = String(asOf || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  const month = months[Number(m[2]) - 1];
  if (!month) return "";
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

function resolveSolYears(solYears, state) {
  if (solYears != null && solYears !== "" && Number.isFinite(Number(solYears))) {
    return Number(solYears);
  }
  const st = String(state || "").trim().toUpperCase();
  if (st === "TX") return 4;
  return null;
}

function solParagraph(solYears, state) {
  const st = String(state || "").trim().toUpperCase();
  if (st === "TX" && solYears === 4) {
    return [
      "Please verify whether this alleged debt is within the statute of limitations.",
      "In Texas, a written contract is generally subject to a limitations period of 4 years (Tex. Civ. Prac. & Rem. Code § 16.004).",
      "State the date you contend any limitations period began to run.",
      "I do not admit that the alleged debt is within that period."
    ].join(" ");
  }
  if (solYears != null) {
    return [
      `Please verify whether this alleged debt is within the ${solYears}-year statute of limitations in my state.`,
      "State the date you contend any limitations period began to run.",
      "I do not admit that the alleged debt is within that period."
    ].join(" ");
  }
  return [
    "Please verify the statute of limitations in my state as it applies to this alleged debt,",
    "including the date you contend any limitations period began to run.",
    "I do not admit that the alleged debt is within any limitations period."
  ].join(" ");
}

function identityLines(identity = {}) {
  const cityLine = [identity.city, identity.state, identity.zip].filter(Boolean).join(", ");
  return [identity.fullName || "[Consumer Name]", identity.addressLine1, cityLine].filter(Boolean);
}

function furnisherLines(furnisher = {}) {
  const lines = Array.isArray(furnisher.addressLines) ? furnisher.addressLines.filter(Boolean) : [];
  return [furnisher.name || "[Collector / Furnisher]", ...lines];
}

function accountBlock(account = {}, furnisherName) {
  const last4 = last4Only(account.last4);
  const lines = [
    `Re: Written validation demand under FDCPA § 809(b) / 15 U.S.C. § 1692g(b)`,
    `Alleged account ending ${last4}`
  ];
  if (account.originalCreditor) {
    lines.push(`Original creditor (as alleged): ${account.originalCreditor}`);
  }
  const current = account.creditor || furnisherName;
  if (current) lines.push(`Current collector / alleged creditor: ${current}`);
  if (account.accountType) lines.push(`Alleged account type: ${account.accountType}`);
  if (account.balanceLabel) lines.push(`Alleged balance: ${account.balanceLabel}`);
  return lines;
}

/**
 * Build a consumer-facing FDCPA validation letter (plain text).
 * @param {{
 *   identity?: { fullName?: string, addressLine1?: string, city?: string, state?: string, zip?: string },
 *   furnisher?: { name?: string, addressLines?: string[] },
 *   account?: { creditor?: string, last4?: string, balanceLabel?: string, originalCreditor?: string, accountType?: string },
 *   asOf?: string,
 *   solYears?: number|null
 * }} opts
 * @returns {{ type: string, text: string, solYears: number|null }}
 */
export function buildFurnisherValidationLetter({
  identity = {},
  furnisher = {},
  account = {},
  asOf,
  solYears
} = {}) {
  const years = resolveSolYears(solYears, identity.state);
  const dateLine = formatAsOf(asOf);
  const name = identity.fullName || "[Consumer Name]";
  const furnisherName = furnisher.name || "[Collector / Furnisher]";

  const text = [
    "COVER",
    COVER,
    "",
    dateLine,
    ...identityLines(identity),
    "",
    "VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED",
    "",
    ...furnisherLines(furnisher),
    "",
    ...accountBlock(account, furnisherName),
    "",
    `I dispute the alleged debt identified above and demand validation under the Fair Debt Collection Practices Act (FDCPA) § 809(b), 15 U.S.C. § 1692g(b). I do not admit that I owe this alleged debt, that the amount is correct, or that you have the right to collect it.`,
    "",
    "This is a timely written validation demand. Until you mail validation to me, you must cease collection of the alleged debt, including credit bureau reporting.",
    "",
    "I demand that you provide, in writing:",
    "",
    "1. The original signed agreement that created this alleged debt.",
    "2. An itemized balance from a defined itemization date, as required by Regulation F, 12 C.F.R. § 1006.34, showing interest, fees, payments, and credits.",
    "3. The complete chain of title and all assignments from the original creditor to you.",
    "4. Proof that you own this alleged debt or are authorized to collect it.",
    `5. ${solParagraph(years, identity.state)}`,
    "",
    "Mail the validation to me at the address above. I am sending this letter by Certified Mail, Return Receipt Requested, and I ask that you respond the same way.",
    "",
    "If you continue collection — including furnishing information about this alleged debt to a consumer reporting agency — without first mailing validation, you may be liable under FDCPA § 813, 15 U.S.C. § 1692k, for actual damages, statutory damages, and attorney's fees. This letter is a validation demand. It is not a lawsuit.",
    "",
    handwrittenSignOff(name)
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === "" && i > 1))
    .join("\n")
    .replace(/^\n+/, "");

  return {
    type: LETTER_TYPES.FURNISHER_VALIDATION,
    text,
    solYears: years
  };
}

/**
 * Render the validation letter as a plain, unbranded PDF.
 * @param {Parameters<typeof buildFurnisherValidationLetter>[0]} opts
 * @returns {Promise<Uint8Array>}
 */
export async function renderFurnisherValidationPdf(opts = {}) {
  const { text } = buildFurnisherValidationLetter(opts);
  return renderLetterPdf({ text, identity: opts.identity });
}

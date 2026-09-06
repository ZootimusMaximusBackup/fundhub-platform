// Deterministic dispute letter body from a violation list.
// NEVER invents violations. No ruleId → no claim.
// Prose variance comes from seeded openings/closings/ordering — not from inventing facts.

import { citationsFor, metro2RefFor } from "../rules/citations.mjs";
import { openingFor, closingFor, roundInstructions, rotateViolations, ROUND } from "./prompts.mjs";
import { formatComplaintFilings } from "../rounds/complaint-filing.mjs";
import { resolvedCitationBlock } from "./citations-assert.mjs";
import { generateWithVarianceGate, structuralFingerprint } from "./variance.mjs";
import { handwrittenSignOff } from "./sign-block.mjs";
import { requireConsumerName } from "./consumer-name.mjs";

function bureauName(code) {
  return ({ EX: "Experian", EQ: "Equifax", TU: "TransUnion" })[String(code || "").toUpperCase()] || String(code || "Credit Bureau");
}

function hashSeed(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const RULE_PLAIN_NAMES = Object.freeze({
  "M2-005": "Stale Date of Account Information",
  "M2-007": "Obsolete item",
  "M2-011": "Status-balance contradiction",
  "M2-031": "Stale former address",
  "M2-036": "Duplicate same-day inquiry"
});

/**
 * The prompt bank's Round 1 / Round 3 / furnisher lines name Metro 2 outright.
 * A letter whose every claim is a derogatory-item claim (../diy/derogatory.mjs)
 * asserts no Metro 2 defect, so saying so would be a false statement in a mailed
 * letter — and a false statement is exactly what a furnisher uses to call the
 * dispute frivolous. These are the accurate substitutes, applied ONLY when no
 * M2- rule is present. A mixed letter keeps the original wording, because then
 * the Metro 2 claim really is there.
 */
const WITHOUT_METRO2 = Object.freeze({
  "I dispute the Metro 2 field defects identified below and ask you to delete or correct them.":
    "I dispute the items identified below and ask you to delete or correct them.",
  "This Round 3 letter is the last bureau notice on these Metro 2 defects. It is not a lawsuit.":
    "This Round 3 letter is the last bureau notice on these items. It is not a lawsuit.",
  "Please investigate the Metro 2 defects below on accounts you furnish.":
    "Please investigate the items below on accounts you furnish.",
  "The items below have Metro 2 reporting defects that make my file inaccurate or misleading.":
    "The items below are reported inaccurately or in a way that makes my file misleading."
});

/** Does this letter carry at least one Metro 2 rule finding? */
export function hasMetro2Claim(violations) {
  return (violations || []).some((v) => /^M2-/.test(String(v?.ruleId || "")));
}

/**
 * The two claims that say the file is RIGHT.
 *
 * COMPLIANCE REVIEW REQUIRED — dispute logic.
 *
 * The personal-information floor (../diy/personal-info-floor.mjs) runs for every
 * repair-path client on every round, so a client whose file is spotless gets a
 * letter whose every claim is one of these: the file reports one name, it should
 * stay that one name; it reports one address, it should stay that one address.
 * A letter cannot say "these two things are right, please fix them" — the
 * surrounding prose was written for claims that dispute something.
 *
 * So the same substitution mechanism WITHOUT_METRO2 already uses is extended:
 * when EVERY claim in the letter is a confirmation, the lines that either state
 * the file is inaccurate or demand deletion or correction of the items in this
 * letter are swapped for lines that ask for the confirmation and cleanup the
 * claims actually request. Lines that do neither are left exactly as they are.
 * A letter with even one real dispute in it keeps the original wording, because
 * then the dispute really is there.
 */
const CONFIRMATION_RULE_IDS = Object.freeze(["PI-NAME-CONFIRM", "PI-ADDRESS-CONFIRM"]);

/** Is this one of the claims that asserts the file is correct? */
function isConfirmationClaim(v) {
  return CONFIRMATION_RULE_IDS.includes(String(v?.ruleId || ""));
}

/** Does EVERY claim in this letter say the file is correct? */
function isConfirmationOnly(violations) {
  const list = (violations || []).filter((v) => v && v.ruleId);
  return list.length > 0 && list.every(isConfirmationClaim);
}

/* Keyed by the exact line the prompt bank produced. Consulted before
   WITHOUT_METRO2, so a line that appears in both takes the confirmation
   wording. Every replacement stays distinct from its neighbours in the same
   pool: three bureau letters draw three different openings and three different
   closings by design (see the bureau-spread note in buildLetterText), and
   collapsing two of them onto one line would hand the variance gate two letters
   it has to refuse. */
const CONFIRMATION_ONLY = Object.freeze({
  // ── Round 1 ──────────────────────────────────────────────────────────────
  "I am writing to dispute inaccurate information on my credit file.":
    "I am writing about the personal information on my credit file.",
  "The following accounts are reported inaccurately on my consumer report.":
    "This letter is about the personal information on my consumer report, not about an account.",
  "I dispute the Metro 2 field defects identified below and ask you to delete or correct them.":
    "I ask you to confirm the personal information you hold on me and to hold my file to it.",
  "Please investigate and correct the reporting errors on my file as required by federal law.":
    "Please review the personal information on my file and confirm in writing what it holds.",
  "The items below have Metro 2 reporting defects that make my file inaccurate or misleading.":
    "The requests below are about the personal information on my file — the name and the address my file is reported under.",
  "Please reinvestigate each item within 30 days under FCRA section 611(a)(1). I also ask for the method of verification for any item you keep on the file.":
    "Please review the personal information on my file within 30 days and send me written confirmation of what it holds.",
  "Delete or correct each item after a reasonable investigation, and send written results to the address above.":
    "Act on each request above and send written results to the address above.",
  "Delete or correct each item after a real investigation, and confirm in writing.":
    "Confirm in writing what my personal information holds once you have reviewed it.",
  "I request written confirmation of every deletion and every correction made to my file.":
    "I request written confirmation of what my personal information holds, and of any change you make to it.",
  "If you rubber-stamp these items without a real investigation, my next letter will be a Round 2 method-of-verification demand. A CFPB or attorney-general complaint is reserved for later. This is not a final notice.":
    "If you do not answer, my next letter will be a Round 2 method-of-verification demand. A CFPB or attorney-general complaint is reserved for later. This is not a final notice.",
  /* ── Round 2 ────────────────────────────────────────────────────────────
     A Round 2 letter whose Round 1 was a confirmation request cannot say "I
     already disputed these items" — nothing was disputed. These say what did
     happen: an earlier letter about the same personal information. */
  "I already disputed these items. They still show as verified, or you never answered.":
    "I wrote to you before about the personal information on my file. This letter follows that up.",
  "You did not tell me how you verified the items listed below after my first dispute.":
    "This is a second letter about the personal information on my file.",
  "I am writing again because the prior reinvestigation did not describe the method of verification.":
    "I am writing again about the name and the address my file is reported under.",
  "I already sent a prior dispute. Your response marked items as verified, or you did not answer, without telling me the method of verification.":
    "This letter follows up my earlier letter about the personal information on my file.",
  "If you cannot produce that method, delete the items. I will then dispute the same items with the furnisher.":
    "If your records do not match what I have set out above, correct my personal information and tell me in writing what you changed.",
  "If you cannot produce that method, delete the items. I will then dispute them with the furnisher.":
    "If your records do not support what my file reports, correct my personal information and tell me in writing what you changed.",
  // ── Round 3 (also used by rounds 4, 5 and 6) ─────────────────────────────
  "I already asked you to reinvestigate and to describe your method of verification. The defects remain.":
    "I already asked you to confirm the personal information on my file. It is still not settled.",
  "Under FCRA section 611(a)(5)(A), delete each item you cannot verify.":
    "Under FCRA section 611(a)(5)(A), delete any personal information on my file you cannot verify as mine.",
  "I demand deletion of the unverifiable items below within 15 days.":
    "I ask you to settle the personal information on my file within 15 days.",
  "Two prior disputes did not produce a reasonable investigation or a method of verification.":
    "Two earlier letters about the personal information on my file have not settled it.",
  "Under FCRA section 611(a)(5)(A), delete each item you cannot verify. I demand deletion within 15 days of this letter.":
    "Under FCRA section 611(a)(5)(A), delete any name or address on my file you cannot verify as mine, and confirm my personal information within 15 days of this letter.",
  "Send written confirmation of every deletion to the address above.":
    "Send written confirmation of my personal information to the address above.",
  "Delete each unverifiable item within 15 days under FCRA section 611(a)(5)(A).":
    "Within 15 days, confirm my personal information and delete anything attached to it that is not mine.",
  "If these items remain after 15 days, I will file with the CFPB and my state attorney general.":
    "If my personal information is not settled after 15 days, I will file with the CFPB and my state attorney general.",

  /* ── ADDED 2026-09-04 — the lines the first pass missed ─────────────────
     Round 1 was described as covered and was not: three of its six openings
     and three of its six closings still asked for a reinvestigation, a method
     of verification, or accused the bureau of rubber-stamping items that this
     letter never disputed. Rounds 2 and 3 were worse — the whole Round 2
     demand paragraph, which is the loudest sentence in the letter, still
     demanded the method of verification for every item and every furnisher's
     name and telephone number in a letter whose every item says the file is
     correct. Every line below is one a confirmation-only letter could actually
     draw. */

  // ── Round 1, remaining ───────────────────────────────────────────────────
  "This letter asks you to reinvestigate the items listed below under the FCRA.":
    "This letter asks you to review the personal information listed below under the FCRA.",
  "I am exercising my rights under 15 U.S.C. § 1681i regarding the items that follow.":
    "I am writing under 15 U.S.C. § 1681e(b) about the personal information that follows.",
  "Please finish this reinvestigation within 30 days and send written results to the address above.":
    "Please answer the requests above within 30 days and send written results to the address above.",
  "I also ask for the method of verification for any item you keep on my file.":
    "I also ask you to tell me the source of the personal information you hold for me.",
  "If you rubber-stamp these items, my next letter will be a Round 2 method-of-verification demand.":
    "If you do not answer these requests, I will write to you again.",

  // ── Round 2, remaining ───────────────────────────────────────────────────
  "This follow-up asks for the method of verification under the FCRA.":
    "This follow-up asks you to confirm the personal information on my file under the FCRA.",
  "The items below remain on my file without a stated method of verification.":
    "The requests below concern the personal information my file is reported under.",
  "Please treat this as a Round 2 request for method of verification and furnisher contact information.":
    "Please treat this as a Round 2 request to confirm the personal information on my file.",
  /* THE ONE THAT MATTERED MOST. This is instr.demand for Round 2 — the
     paragraph that sits in the middle of every Round 2 letter. Unsubstituted,
     a letter whose every item said "this name is right" demanded the method of
     verification for that name and the telephone number of the furnisher that
     supplied it. There is no furnisher of a consumer's own name, and nothing
     was verified because nothing was disputed. */
  "Under FCRA section 611(a)(7), describe the method of verification for each item — who you contacted, what records they sent, and what you compared. Under section 611(a)(6)(B)(iii), give me each furnisher's name, address, and telephone number.":
    "Confirm in writing the personal information my file is reported under, and tell me what records you relied on to decide it is correct. If anything attached to my personal information is not mine, delete it and tell me in writing what you deleted.",
  "Describe the method of verification for each item under FCRA section 611(a)(7).":
    "Confirm in writing the personal information my file is reported under.",
  "Give me each furnisher's name, address, and telephone number under section 611(a)(6)(B)(iii).":
    "Tell me where any personal information attached to my file came from.",
  "If the furnisher also fails, I will file with the Consumer Financial Protection Bureau.":
    "If my personal information is still not settled, I will file with the Consumer Financial Protection Bureau.",
  "Send the method of verification and furnisher contacts in writing to the address above.":
    "Send your written answer to the address above.",
  "If the furnisher also fails, I will file with the Consumer Financial Protection Bureau. This letter is not a CFPB complaint and not a lawsuit.":
    "If my personal information is still not settled after this letter, I will file with the Consumer Financial Protection Bureau. This letter is not a CFPB complaint and not a lawsuit.",

  // ── Round 3, remaining (rounds 4, 5 and 6 draw the same pool) ────────────
  "This is my last letter to your bureau on these items before I file with the CFPB and my state attorney general.":
    "This is my last letter to your bureau about my personal information before I file with the CFPB and my state attorney general.",
  "This is a further notice to your bureau on these items before I file with the CFPB and my state attorney general.":
    "This is a further notice to your bureau about my personal information before I file with the CFPB and my state attorney general.",
  "This is my last letter to your bureau on these items before a CFPB and state attorney-general filing.":
    "This is my last letter to your bureau about my personal information before a CFPB and state attorney-general filing.",
  "Do not treat this letter as a court filing. It is the last bureau notice on these items.":
    "Do not treat this letter as a court filing. It is the last bureau notice about my personal information.",
  "This Round 3 letter is the last bureau notice on these items. It is not a lawsuit.":
    "This Round 3 letter is the last bureau notice about my personal information. It is not a lawsuit.",
  /* The same line before WITHOUT_METRO2 has touched it. The confirmation table
     is consulted FIRST, so the Metro 2 spelling is the one that actually
     arrives here; the plain spelling above is kept for the case where some
     other table gets there first. */
  "This Round 3 letter is the last bureau notice on these Metro 2 defects. It is not a lawsuit.":
    "This Round 3 letter is the last bureau notice about my personal information. It is not a lawsuit.",

  /* ── Rounds 4, 5 and 6 ──────────────────────────────────────────────────
     These rounds got their own paraphrases on 2026-09-04, because sharing
     Round 3's words meant the variance gate refused every Round 4, 5 and 6
     letter and the ladder stopped at three (./prompts.mjs carries the
     measurement). Five of those new lines demand deletion of "the items below",
     which in a confirmation-only letter is the same contradiction this whole
     table exists for: the items below are the consumer's own correct name and
     address.

     Deletion of what the bureau CANNOT VERIFY is deliberately left in the
     confirmation wording. The PI-*-CONFIRM claims ask for exactly that — "if a
     name or spelling that is not mine is attached to this file, delete it" — so
     it is the one deletion a confirmation-only letter really does request. */
  "Under the Fair Credit Reporting Act I ask your bureau to delete the items below, which my file still carries.":
    "Under the Fair Credit Reporting Act I ask your bureau to settle who my record says I am.",
  "Under the Fair Credit Reporting Act, delete the items below. My state attorney general is the next place I go.":
    "Put my personal details right, as the Fair Credit Reporting Act requires. My state's attorney general is where I go after this.",
  "My file still shows the items set out below. This letter asks your bureau to take them off it.":
    "Your record of who I am is set out below. I am asking you to confirm it and to hold my file to it.",

  /* The rest of the Round 4, 5 and 6 pools. Every line that calls the letter's
     contents "items", or says they are "still" on the file, or asks what "came
     off" it, is rewritten — in a confirmation-only letter the contents are the
     consumer's own correct name and address, nothing is being asked to come off,
     and "still" makes a claim about an earlier round nobody has recorded. */
  // -- Round 4 --------------------------------------------------------------
  "The items listed below are still on my consumer file, and I am carrying them to the Consumer Financial Protection Bureau.":
    "My consumer file reports the personal information set out below, and I am ready to take this to the Consumer Financial Protection Bureau.",
  "This letter concerns items my consumer file still reports, and what I intend to do if it keeps reporting them.":
    "This letter concerns the personal information my consumer file reports, and what I intend to do if it is not settled.",
  "Your bureau still reports the items below about me. A federal regulator takes complaints about exactly this.":
    "Your bureau holds the personal information below about me. A federal regulator takes complaints about how that information is kept.",
  "I am putting your bureau on notice about the items below, which remain on the file you hold on me.":
    "I am putting your bureau on notice about the personal information below, which is what the file you hold on me should carry and nothing else.",
  "Tell me in writing what you removed and what you kept, and why you kept it.":
    "Tell me in writing what my personal information holds, and what if anything you changed about it.",
  /* ADDED 2026-09-06. Its neighbour above was rewritten and this one was not,
     so a confirmation-only Round 4 letter still asked the bureau to report
     "what you removed" — nothing in that letter asks for a removal except of a
     name or address that is not the consumer's, which may well be none. Kept
     deliberately unlike the line above: both are Round 4 closings, and the
     three bureau letters draw closings two pool positions apart, so these two
     can land in the same batch and the variance gate compares them. */
  "Write to me at the address above with what you did and what you removed.":
    "Write to me at the address above and say what my file now holds as my name and my address.",
  "My consumer file still reports the items set out below.":
    "Who your bureau says I am is written out below.",
  "Tell me in writing what came off my file and what stayed on it.":
    "Put your written statement in the post to the address at the top of this page.",
  // -- Round 5 --------------------------------------------------------------
  "The items below are still on my file, and my state attorney general accepts complaints about a credit bureau that keeps reporting them.":
    "My state attorney general accepts complaints about how a credit bureau keeps a consumer's personal information, and mine is set out below.",
  "My consumer file continues to report the items set out below, and this letter is the notice I give before going to my state attorney general.":
    "My consumer file reports the personal information set out below, and this letter is the notice I give before going to my state attorney general.",
  "Your bureau still reports the items below. I am preparing a complaint to the attorney general of my state.":
    "This letter is about the personal information below. I am preparing a complaint to the attorney general of my state.",
  "This letter is about items my file still carries and about the state office I will take them to.":
    "This letter is about the personal information my file carries and about the state office I will take it to.",
  "I am giving your bureau written notice about the items below before I take them to my state's attorney general.":
    "I am giving your bureau written notice about the personal information below before I take this to my state's attorney general.",
  "Write back and name what came off my file and what stayed on it.":
    "Write back and name the personal information my file carries.",
  "The items set out below have not come off the file your bureau holds on me.":
    "The personal information set out below is what the file your bureau holds on me should carry.",
  // -- Round 6 --------------------------------------------------------------
  "This is the final written notice I will send your bureau about the items below.":
    "This is the final written notice I will send your bureau about my personal information.",
  "My file still reports the items set out below, and this letter closes my direct correspondence with your bureau about them.":
    "This letter closes my direct correspondence with your bureau about the personal information set out below.",
  "Everything below is still on the file you hold on me. This is the last of these letters.":
    "Everything below concerns the file you hold on me. This is the last of these letters.",
  "I have nothing further to send your bureau after this letter about the items below.":
    "I have nothing further to send your bureau after this letter about my personal information.",
  "This letter ends what I will send you directly about the items my file still reports below.":
    "This letter ends what I will send you directly about the personal information below.",
  "Your bureau still reports the items below. This is my closing written notice about them.":
    "This is my closing written notice about the personal information below.",
  "Put in writing what came off the file and what did not.":
    "Put in writing what my personal information holds.",
  "What is set out below is still on the file your bureau holds on me.":
    "What is set out below is what the file your bureau holds on me should carry.",
  "Write back and say what you removed and what you kept.":
    "Write back and say what my personal information holds.",
  "FCRA section 611(a)(5)(A) requires you to delete an item you cannot verify. Do that within 15 days of this letter, for every item below you cannot stand behind.":
    "Send me a written statement of the name and the address your bureau has recorded for me. Anything else your records hold against my name, take it off — FCRA section 611(a)(5)(A) does not let a bureau keep what it cannot verify. Fifteen days.",
  "Delete every item below that you cannot verify, within 15 days, as FCRA section 611(a)(5)(A) requires.":
    "Tell me in writing, inside fifteen days, exactly what personal details your bureau holds against my name. Whatever sits there that is not mine, FCRA section 611(a)(5)(A) says comes off.",
  "Under FCRA section 611(a)(5)(A) an item you cannot verify comes off. Take the items below off within 15 days unless you can verify them.":
    "One person, one name, one address — that is what my record should show. Under FCRA section 611(a)(5)(A) whatever else is stuck to it, and cannot be proved mine, comes off. Answer me inside fifteen days."
});

/**
 * A letter that BOTH disputes something and confirms something.
 *
 * COMPLIANCE REVIEW REQUIRED — dispute logic.
 *
 * The confirmation-only case above is the loud one. This is the quiet one, and
 * on a real repair client it is the COMMON one: the personal-information floor
 * always adds "this is my one name, hold the file to it", and almost every file
 * also carries something genuinely wrong. The letter then lists both, and the
 * demand paragraph says "delete or correct each item" — which, read as written,
 * asks the bureau to delete the consumer's own correctly-reported name.
 *
 * So where a letter carries at least one confirmation AND at least one real
 * dispute, the demands are scoped to the disputed items and the confirmations
 * are asked for separately. The item blocks already carry the distinction: a
 * dispute is headed "Violation", a confirmation is headed "Request"
 * (formatViolationParagraph).
 *
 * A letter with no confirmation in it is untouched by this table, which is every
 * letter that existed before the floor was built.
 */
const MIXED_WITH_CONFIRMATIONS = Object.freeze({
  // -- Round 1 --------------------------------------------------------------
  "The following accounts are reported inaccurately on my consumer report.":
    "This letter is about items reported inaccurately on my consumer report and about the personal information my file carries.",
  "Please reinvestigate each item within 30 days under FCRA section 611(a)(1). I also ask for the method of verification for any item you keep on the file.":
    "Please reinvestigate each disputed item below within 30 days under FCRA section 611(a)(1), and answer the personal-information requests below. I also ask for the method of verification for any disputed item you keep on the file.",
  "Delete or correct each item after a reasonable investigation, and send written results to the address above.":
    "Delete or correct each disputed item after a reasonable investigation, act on the personal-information requests below, and send written results to the address above.",
  "Delete or correct each item after a real investigation, and confirm in writing.":
    "Delete or correct each disputed item after a real investigation, and confirm in writing.",
  "I also ask for the method of verification for any item you keep on my file.":
    "I also ask for the method of verification for any disputed item you keep on my file.",
  "I request written confirmation of every deletion and every correction made to my file.":
    "I request written confirmation of every deletion and every correction made to my file, and of what my personal information holds.",
  // -- Round 2 --------------------------------------------------------------
  "I already disputed these items. They still show as verified, or you never answered.":
    "I already disputed items on this file. They still show as verified, or you never answered.",
  "You did not tell me how you verified the items listed below after my first dispute.":
    "You did not tell me how you verified the disputed items listed below after my first dispute.",
  "Under FCRA section 611(a)(7), describe the method of verification for each item — who you contacted, what records they sent, and what you compared. Under section 611(a)(6)(B)(iii), give me each furnisher's name, address, and telephone number.":
    "Under FCRA section 611(a)(7), describe the method of verification for each disputed item below — who you contacted, what records they sent, and what you compared. Under section 611(a)(6)(B)(iii), give me the name, address and telephone number of each furnisher you contacted. Answer the personal-information requests below as well.",
  "Describe the method of verification for each item under FCRA section 611(a)(7).":
    "Describe the method of verification for each disputed item under FCRA section 611(a)(7).",
  "If you cannot produce that method, delete the items. I will then dispute the same items with the furnisher.":
    "If you cannot produce that method, delete the disputed items. I will then dispute the same items with the furnisher.",
  "If you cannot produce that method, delete the items. I will then dispute them with the furnisher.":
    "If you cannot produce that method, delete the disputed items. I will then dispute them with the furnisher.",
  // -- Round 3 (rounds 4, 5 and 6 draw the same pool) ------------------------
  "Under FCRA section 611(a)(5)(A), delete each item you cannot verify.":
    "Under FCRA section 611(a)(5)(A), delete each disputed item you cannot verify.",
  "Under FCRA section 611(a)(5)(A), delete each item you cannot verify. I demand deletion within 15 days of this letter.":
    "Under FCRA section 611(a)(5)(A), delete each disputed item you cannot verify. I demand deletion within 15 days of this letter, and an answer to the personal-information requests below.",
  "Send written confirmation of every deletion to the address above.":
    "Send written confirmation of every deletion, and of what my personal information holds, to the address above.",
  // -- Rounds 4, 5 and 6 ----------------------------------------------------
  "Under the Fair Credit Reporting Act I ask your bureau to delete the items below, which my file still carries.":
    "Under the Fair Credit Reporting Act I ask your bureau to delete the disputed items below, which my file still carries, and to settle who my record says I am.",
  "Under the Fair Credit Reporting Act, delete the items below. My state attorney general is the next place I go.":
    "Under the Fair Credit Reporting Act, delete the disputed items below and put my personal details right. My state attorney general is the next place I go.",
  "My file still shows the items set out below. This letter asks your bureau to take them off it.":
    "My file still shows the disputed items set out below. This letter asks your bureau to take them off it, and to confirm the name and address my file is kept under.",
  "FCRA section 611(a)(5)(A) requires you to delete an item you cannot verify. Do that within 15 days of this letter, for every item below you cannot stand behind.":
    "FCRA section 611(a)(5)(A) requires you to delete an item you cannot verify. Do that within 15 days of this letter, for every disputed item below you cannot stand behind. My name and my address are set out here too; confirm them in the same reply.",
  "Delete every item below that you cannot verify, within 15 days, as FCRA section 611(a)(5)(A) requires.":
    "Delete every disputed item below that you cannot verify, within 15 days, as FCRA section 611(a)(5)(A) requires. Tell me at the same time exactly what personal details your bureau holds against my name.",
  "Under FCRA section 611(a)(5)(A) an item you cannot verify comes off. Take the items below off within 15 days unless you can verify them.":
    "Under FCRA section 611(a)(5)(A) an item you cannot verify comes off. Take the disputed items below off within 15 days unless you can verify them. One person, one name, one address — say in writing that is what my record shows.",

  /* ── ADDED 2026-09-06 — the rest of the mixed letter ────────────────────
     MEASURED, by building every letter this writer can build. Three claim
     mixes (confirmation-only, mixed with a Metro 2 claim, mixed without one)
     x 6 rounds x 3 bureaus x 18 regeneration attempts = 972 letters, read line
     by line. On the merge commit that brought PR 339 across: 855 sentences,
     55 of them distinct, said something the confirmations in that same letter
     did not support. Rounds 2, 3, 5 and 6 had no mixed wording at all, and
     rounds 1 and 4 were half covered. After the additions below the same sweep
     reports 216 hits, 12 distinct, every one of them from the two families
     named at the bottom of this comment as deliberate.

     What was wrong was always the same shape. "The items below are reported
     inaccurately." "Delete each item you cannot verify." "The defects remain."
     "Your bureau still reports the items below." In a letter whose last two
     items say the consumer's own name and the consumer's own address are
     CORRECT and should stay, every one of those sentences is a false statement
     about those two items, mailed to a credit bureau in the consumer's name.

     THE RULE APPLIED TO EVERY LINE BELOW: the word "items" is narrowed to
     "disputed items" wherever the sentence makes a claim about them or asks for
     their deletion, and the confirmations are named separately where the
     sentence is a demand. A sentence that only states the letter's SCOPE —
     "this is my last letter to your bureau on these items" — is left alone,
     because it asserts nothing about whether those items are right or wrong.

     "METRO 2" IS DROPPED FROM EVERY REPLACEMENT BELOW, including the two lines
     that named it. accurate() consults this table BEFORE WITHOUT_METRO2, so a
     replacement written here is the final text and would have to be true of a
     mixed letter with no Metro 2 claim in it as well. The per-claim blocks still
     print "Metro 2 field: …" for each M2 claim, and the subject line still says
     Metro 2, so nothing that was provable is lost.

     WHAT IS DELIBERATELY NOT REWRITTEN: "remove what you cannot verify" and its
     three siblings in the Round 4, 5 and 6 closings. A confirmation claim asks
     for exactly that — "if any name or spelling other than mine is attached to
     this file, delete it" — so a demand scoped by verifiability is the one
     deletion demand both kinds of claim really do make. Same reasoning as the
     CONFIRMATION_ONLY table above.

     DISTINCTNESS IS CHECKED, NOT HOPED FOR. Three bureau letters draw openings
     at pool offsets 0 / 2 / 4 and closings at 0 / 4 / 2, so any two lines in one
     pool can meet in one batch. Every replacement below is a different string
     from every other line in its own pool, before and after substitution —
     asserted by ./letter-honesty.test.mjs. */

  // ── Round 1, the rest ────────────────────────────────────────────────────
  "I am writing to dispute inaccurate information on my credit file.":
    "I am writing about inaccurate information on my credit file, and about the personal information my file is kept under.",
  "This letter asks you to reinvestigate the items listed below under the FCRA.":
    "This letter asks you to reinvestigate the disputed items below under the FCRA, and to answer the personal-information requests set out with them.",
  "I dispute the Metro 2 field defects identified below and ask you to delete or correct them.":
    "I dispute the items identified below as inaccurate and ask you to delete or correct them. The personal-information requests below ask you to confirm my name and my address, not to delete them.",
  "Please investigate and correct the reporting errors on my file as required by federal law.":
    "Please investigate and correct the reporting errors set out below, as federal law requires, and confirm the personal information my file is kept under.",
  "I am exercising my rights under 15 U.S.C. § 1681i regarding the items that follow.":
    "I am exercising my rights under 15 U.S.C. § 1681i and § 1681e(b) regarding the disputed items and the personal-information requests that follow.",
  "If you rubber-stamp these items, my next letter will be a Round 2 method-of-verification demand.":
    "If you rubber-stamp the disputed items, my next letter will be a Round 2 method-of-verification demand.",
  "The items below have Metro 2 reporting defects that make my file inaccurate or misleading.":
    "The disputed items below make my file inaccurate or misleading. The requests below are about the name and the address my file is reported under.",
  "If you rubber-stamp these items without a real investigation, my next letter will be a Round 2 method-of-verification demand. A CFPB or attorney-general complaint is reserved for later. This is not a final notice.":
    "If you rubber-stamp the disputed items without a real investigation, my next letter will be a Round 2 method-of-verification demand. A CFPB or attorney-general complaint is reserved for later. This is not a final notice.",

  // ── Round 2, the rest ────────────────────────────────────────────────────
  "The items below remain on my file without a stated method of verification.":
    "The disputed items below remain on my file without a stated method of verification.",
  "Please treat this as a Round 2 request for method of verification and furnisher contact information.":
    "Please treat this as a Round 2 request for method of verification and furnisher contact information, and as a request to confirm the personal information my file is kept under.",
  "Give me each furnisher's name, address, and telephone number under section 611(a)(6)(B)(iii).":
    "Give me the name, address and telephone number of each furnisher you contacted about a disputed item, under section 611(a)(6)(B)(iii).",

  // ── Round 3, the rest ────────────────────────────────────────────────────
  "I already asked you to reinvestigate and to describe your method of verification. The defects remain.":
    "I already asked you to reinvestigate and to describe your method of verification. The disputed items remain on my file.",
  "I demand deletion of the unverifiable items below within 15 days.":
    "I demand deletion of the unverifiable disputed items below within 15 days, and an answer to the personal-information requests with them.",
  "This Round 3 letter is the last bureau notice on these Metro 2 defects. It is not a lawsuit.":
    "This Round 3 letter is the last bureau notice on the disputed items below. It is not a lawsuit.",
  "Delete each unverifiable item within 15 days under FCRA section 611(a)(5)(A).":
    "Delete each unverifiable disputed item within 15 days under FCRA section 611(a)(5)(A).",
  "If these items remain after 15 days, I will file with the CFPB and my state attorney general.":
    "If the disputed items remain after 15 days, I will file with the CFPB and my state attorney general.",

  // ── Round 4, the rest ────────────────────────────────────────────────────
  "The items listed below are still on my consumer file, and I am carrying them to the Consumer Financial Protection Bureau.":
    "The disputed items listed below are still on my consumer file, and I am carrying them to the Consumer Financial Protection Bureau. My name and my address are set out with them, for your confirmation.",
  "This letter concerns items my consumer file still reports, and what I intend to do if it keeps reporting them.":
    "This letter concerns disputed items my consumer file still reports, the personal information it is kept under, and what I intend to do if this is not settled.",
  "Your bureau still reports the items below about me. A federal regulator takes complaints about exactly this.":
    "Your bureau still reports the disputed items below about me. A federal regulator takes complaints about exactly this.",
  "I am putting your bureau on notice about the items below, which remain on the file you hold on me.":
    "I am putting your bureau on notice about the disputed items below, which remain on the file you hold on me, and about the personal information that file is kept under.",
  "My consumer file still reports the items set out below.":
    "My consumer file still reports the disputed items set out below, and it is kept under the name and the address set out with them.",
  "Tell me in writing what came off my file and what stayed on it.":
    "Tell me in writing what came off my file, what stayed on it, and what my personal information holds.",

  // ── Round 5, the rest ────────────────────────────────────────────────────
  "The items below are still on my file, and my state attorney general accepts complaints about a credit bureau that keeps reporting them.":
    "The disputed items below are still on my file, and my state attorney general accepts complaints about a credit bureau that keeps reporting them.",
  "My consumer file continues to report the items set out below, and this letter is the notice I give before going to my state attorney general.":
    "My consumer file continues to report the disputed items set out below, and this letter is the notice I give before going to my state attorney general.",
  "Your bureau still reports the items below. I am preparing a complaint to the attorney general of my state.":
    "Your bureau still reports the disputed items below. I am preparing a complaint to the attorney general of my state.",
  "This letter is about items my file still carries and about the state office I will take them to.":
    "This letter is about disputed items my file still carries, about the personal information it is kept under, and about the state office I will take this to.",
  "I am giving your bureau written notice about the items below before I take them to my state's attorney general.":
    "I am giving your bureau written notice about the disputed items below, and about the personal information my file is kept under, before I take this to my state's attorney general.",
  "Write back and name what came off my file and what stayed on it.":
    "Write back and name what came off my file, what stayed on it, and what my personal information holds.",
  "The items set out below have not come off the file your bureau holds on me.":
    "The disputed items set out below have not come off the file your bureau holds on me.",

  // ── Round 6, the rest ────────────────────────────────────────────────────
  "My file still reports the items set out below, and this letter closes my direct correspondence with your bureau about them.":
    "My file still reports the disputed items set out below, and this letter closes my direct correspondence with your bureau about them and about the personal information my file is kept under.",
  "Everything below is still on the file you hold on me. This is the last of these letters.":
    "Everything below concerns the file you hold on me — the disputed items still on it, and the name and address it is kept under. This is the last of these letters.",
  "This letter ends what I will send you directly about the items my file still reports below.":
    "This letter ends what I will send you directly about the disputed items my file still reports below.",
  "Your bureau still reports the items below. This is my closing written notice about them.":
    "Your bureau still reports the disputed items below. This is my closing written notice about them and about my personal information.",
  "Put in writing what came off the file and what did not.":
    "Put in writing what came off the file, what did not, and what my personal information holds.",
  "What is set out below is still on the file your bureau holds on me.":
    "The disputed items set out below are still on the file your bureau holds on me, and that file is kept under the name and the address set out with them.",
  "Write back and say what you removed and what you kept.":
    "Write back and say what you removed, what you kept, and what my personal information holds."
});

/**
 * NO LETTER MAY CALL ITSELF THE LAST ONE WHILE ANOTHER BUREAU ROUND CAN FOLLOW.
 *
 * COMPLIANCE REVIEW REQUIRED — dispute logic.
 *
 * Four lines in the Round 3 pool (./prompts.mjs OPENINGS/CLOSINGS R3) call
 * themselves the LAST bureau notice, and one of them names itself "This Round 3
 * letter". Rounds 4, 5 and 6 draw those lines too whenever they fall back to the
 * R3 pool.
 *
 * Until the R4/R5/R6 letters actually produced output, Round 3 saying it was the
 * last bureau letter was TRUE — nothing followed it. It stopped being true the
 * moment those rounds started sending. MEASURED 2026-09-06 BY RENDERING, before
 * this gate reached R3: 972 letters built over six rounds x three bureaus x
 * eighteen attempts x three claim mixes, and 90 of the 162 Round 3 letters
 * carried one of these lines to a credit bureau.
 *
 * So the strip runs for EVERY round with another bureau round after it — R1, R2,
 * R3, R4, R5 and the furnisher letter. R6 is the terminal rung of
 * ../letters/catalog.mjs ROUND_LADDER, so R6 is the one letter allowed to say it
 * is the last, and it says so in its own words (see the R6 pool) rather than in
 * any of the phrases below.
 *
 * Phrase replacement rather than whole-line keys, because each of these lines
 * also has a confirmation-only form and a without-Metro-2 form, and keying the
 * cross product of three tables is how one of the nine gets missed. Applied
 * LAST, after every other table has settled the rest of the sentence.
 *
 * ORDER MATTERS: the "This Round 3 letter" phrase contains the shorter
 * "the last bureau notice" phrase, so it is replaced first.
 */
const NOT_THE_LAST_NOTICE_PHRASES = Object.freeze([
  ["This Round 3 letter is the last bureau notice", "This letter is a further bureau notice"],
  ["This is my last letter to your bureau", "I am writing to your bureau again"],
  ["It is the last bureau notice", "It is a further bureau notice"]
]);

function withoutLastNoticeClaim(line) {
  let out = String(line);
  for (const [from, to] of NOT_THE_LAST_NOTICE_PHRASES) out = out.split(from).join(to);
  return out;
}

/**
 * Is a further bureau letter still on the ladder after this one? R6 is the last
 * rung, so only R6 answers no. Everything else — including an unrecognised round,
 * which falls back to R1 prose — answers yes and gets the strip.
 */
function anotherBureauRoundFollows(round) {
  return String(round || "").trim().toUpperCase() !== ROUND.R6;
}

/**
 * Put one prompt-bank line into wording this particular letter can stand behind.
 *
 * The tables CHAIN — each is consulted on whatever the previous one produced —
 * so a Round 5 confirmation-only letter with no Metro 2 claim gets all the
 * passes it needs and not just the first one that matched.
 *
 * @param {string} line
 * @param {{ metro2Backed?: boolean, confirmationOnly?: boolean,
 *           mixed?: boolean, notTheLastNotice?: boolean }} shape
 */
function accurate(line, shape = {}) {
  let out = String(line);
  if (shape.confirmationOnly && CONFIRMATION_ONLY[out]) out = CONFIRMATION_ONLY[out];
  else if (shape.mixed && MIXED_WITH_CONFIRMATIONS[out]) out = MIXED_WITH_CONFIRMATIONS[out];
  if (!shape.metro2Backed && WITHOUT_METRO2[out]) out = WITHOUT_METRO2[out];
  if (shape.notTheLastNotice) out = withoutLastNoticeClaim(out);
  return out;
}

const SEVERITY_LABEL = Object.freeze({
  deletion: "Deletion-tier",
  strong: "Strong",
  moderate: "Moderate",
  supporting: "Supporting"
});

function lastFourSsn(identity) {
  if (!identity || identity.ssn == null || identity.ssn === "") return null;
  const digits = String(identity.ssn).replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

function plainName(v) {
  if (RULE_PLAIN_NAMES[v.ruleId]) return RULE_PLAIN_NAMES[v.ruleId];
  /* A claim may carry its own name. The derogatory-item claims in
     ../diy/derogatory.mjs do, because they are not Metro 2 rules and there is
     no exhibit reference to fall back on. */
  if (v.plainName) return String(v.plainName).trim();
  const metro = v.metro2Ref || metro2RefFor(v.ruleId);
  if (metro) return String(metro).trim();
  const reason = String(v.reason || "").trim();
  if (reason) return reason.split(/[.;]/)[0].trim().slice(0, 80);
  return v.ruleId;
}

function fieldLine(v) {
  const metro = v.metro2Ref || metro2RefFor(v.ruleId);
  if (metro) return `Metro 2 field: ${metro}`;
  if (v.field != null && String(v.field).trim() !== "") {
    const f = String(v.field).trim();
    return `Metro 2 field: ${/^field\b/i.test(f) ? f : `Field ${f}`}`;
  }
  /* No field and no exhibit reference. A derogatory-item claim asserts no Metro 2
     defect, so naming a field would be the invention this whole module refuses.
     The line is dropped instead — formatViolationParagraph filters nulls. */
  return null;
}

function capItemStatutes(v) {
  const cites = v.citations || citationsFor(v.ruleId) || [];
  const bits = Array.isArray(cites)
    ? [...cites]
    : [...(cites.statutes || []), ...(cites.cases || cites.caseLaw || [])];
  const isCase = (s) => /\bv\.\s/i.test(String(s));
  const statutes = bits.filter((s) => !isCase(s)).map((s) => String(s));
  const cases = bits.filter(isCase).map((s) => String(s));
  const out = statutes.slice(0, 3);
  if (out.length < 2 && cases[0]) out.push(cases[0]);
  return out.slice(0, 3);
}

function accountLine(v) {
  const who = String(v?.creditor || "").trim();
  const last4 = String(v?.account_last4 || v?.accountLast4 || "").replace(/\D/g, "").slice(-4);
  if (!who && !last4) return null;
  if (who && last4) return `Account: ${who} · ending ${last4}`;
  if (who) return `Account: ${who}`;
  return `Account ending ${last4}`;
}

/**
 * What a claim's `observed` / `expected` reads as in a mailed letter.
 *
 * Every Metro 2 claim passes a scalar and keeps exactly the wording it always
 * had. The personal-information floor passes an object, and JSON.stringify put
 * a raw `{"namesReportedOnFile":["Sim Repair"],...}` blob into a letter to a
 * credit bureau. An object is written out as plain phrases instead.
 */
function readableValue(value) {
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const parts = [];
  for (const [key, raw] of Object.entries(value)) {
    if (raw === "") continue;
    if (Array.isArray(raw) && raw.length === 0) continue;
    const label = String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
    let printed;
    /* NULL is unknown and it stays visible as unknown. It is never dropped and
       never turned into a zero. */
    if (raw == null) printed = "not reported";
    else if (Array.isArray(raw)) printed = raw.map((r) => JSON.stringify(String(r))).join(", ");
    else if (typeof raw === "boolean") printed = raw ? "yes" : "no";
    else if (typeof raw === "object") printed = JSON.stringify(raw);
    else printed = JSON.stringify(raw);
    parts.push(`${label}: ${printed}`);
  }
  return parts.length ? parts.join("; ") : JSON.stringify(value);
}

function formatViolationParagraph(v) {
  if (!v?.ruleId) return null;
  const observed = v.observed == null ? "not populated as required" : readableValue(v.observed);
  const expected = v.expected == null ? "compliant Metro 2 reporting" : readableValue(v.expected);
  const statutes = capItemStatutes(v);
  const sev = SEVERITY_LABEL[v.severity] || "Supporting";
  /* A claim that says the file is CORRECT is not a violation and may not be
     headed as one. It is a request, and it is labelled a request. The variance
     gate strips both headings — see CLAIM_RULE_ID in ./variance.mjs. */
  const heading = isConfirmationClaim(v) ? "Request" : "Violation";
  return [
    `${heading} ${v.ruleId} — ${plainName(v)}`,
    fieldLine(v),
    `Severity: ${sev}`,
    accountLine(v),
    v.reason || "Reporting defect identified by deterministic Metro 2 check.",
    `Observed: ${observed}. Expected: ${expected}.`,
    statutes.length ? `Legal basis: ${statutes.join("; ").replace(/\.$/, "")}.` : null
  ].filter(Boolean).join("\n");
}

/**
 * Prior bureau answers become evidence in R2+ letters (spec §5.5 / B3).
 */
export function formatPriorEvidence(priorResponses = []) {
  const lines = [];
  for (const pr of priorResponses || []) {
    if (!pr) continue;
    const dateRaw = pr.date || pr.respondedAt || pr.created_at || null;
    const date = dateRaw ? String(dateRaw).slice(0, 10) : "an earlier date";
    const outcome = String(pr.outcome || "verified").toLowerCase();
    const last4 = String(pr.accountLast4 || pr.account_last4 || "xxxx").replace(/\D/g, "").slice(-4) || "xxxx";
    const excerpt = String(pr.rawExcerpt || pr.raw_text || "").trim().replace(/\s+/g, " ").slice(0, 200);
    let line = `On ${date} you responded '${outcome}' for account ending ${last4}`;
    if (excerpt && excerpt.toLowerCase() !== outcome) {
      line += `: "${excerpt}"`;
    }
    lines.push(`${line}.`);
  }
  return lines;
}

/**
 * Build letter plain text.
 * @param {{
 *   violations: object[],
 *   identity: { fullName, addressLine1, addressLine2?, city, state, zip, ssn?, accountLast4? },
 *   bureau: 'EX'|'EQ'|'TU',
 *   round?: string,
 *   seed?: string|number,
 *   undated?: boolean,
 *   date?: string|null,
 *   priorResponses?: object[],
 *   priorFilings?: object[]
 * }} opts
 */
export function buildLetterText(opts = {}) {
  const violations = (opts.violations || []).filter((v) => v && v.ruleId);
  if (violations.length === 0) {
    throw new Error("no_rule_id_claims — refuse to generate a letter with zero rule-backed violations");
  }
  const identity = opts.identity || {};
  /* THE NAME ON A LETTER TO A CREDIT BUREAU IS A REAL NAME OR THE LETTER IS NOT
     BUILT. ./consumer-name.cjs holds the one predicate every renderer uses. This
     sits beside the zero-claims refusal because it is the same kind of refusal:
     a letter nobody can truthfully address is not a letter, it is a guess with a
     stamp on it. See ../diy/package.mjs, ../diy/deliver.mjs, ./complaints.mjs,
     ./furnisher-validation.mjs, ../../inquiry-ops/letter-draft.mjs,
     ../../underwrite/letter-pack.mjs and the vendor writer — all the same rule. */
  const consumerName = requireConsumerName(identity.fullName, "bureau dispute letter");
  const bureau = String(opts.bureau || "").toUpperCase();
  const round = opts.round || ROUND.R1;
  const instr = roundInstructions(round);
  const seed = hashSeed(opts.seed ?? `${consumerName}:${bureau}:${round}`);
  const ordered = rotateViolations(violations, seed + (opts.attempt || 0) * 7);
  const attempt = Number(opts.attempt) || 0;
  const metro2Backed = hasMetro2Claim(violations);
  const confirmationOnly = isConfirmationOnly(violations);
  /* Both kinds of claim in one letter. See MIXED_WITH_CONFIRMATIONS. */
  const mixed = !confirmationOnly && violations.some(isConfirmationClaim);
  /* Every round but the last strips the "this is my last letter" claim, Round 3
     included — Round 3 stopped being the last bureau letter the day R4, R5 and R6
     started sending. See NOT_THE_LAST_NOTICE_PHRASES. */
  const notTheLastNotice = anotherBureauRoundFollows(round);
  const shape = { metro2Backed, confirmationOnly, mixed, notTheLastNotice };
  /* WHY THE BUREAU IS SPREAD ACROSS THE POOL BY HAND, AND NOT LEFT TO THE SEED.
   *
   * The variance gate strips every itemised claim block before it compares two
   * letters (proseForVariance), so what it actually compares is the header, the
   * opening, the lead and the closing. Two bureau letters that draw the SAME
   * opening and closing are then ~91% identical and the gate refuses the batch —
   * correctly, that is its job.
   *
   * The bureau is already in the seed, so the draw was meant to differ. It did
   * not reliably, for two reasons. The pools hold six lines each and
   * `closingFor(seed + 3)` moves in lockstep with `openingFor(seed)`, so two
   * bureaus whose seeds are congruent mod 6 collide on BOTH lines at once — a
   * one-in-six pair collision, not one in thirty-six, and with three bureaus
   * drawing that is a coin flip on every batch.
   *
   * It bit hardest on the letters added 2026-09-03 for the owner rule "any
   * derogatory deserves a letter" — measured, a repair client with a collection
   * and a charge-off got ONE letter and two `variance_gate_exhausted` refusals —
   * but nothing about it was specific to those. A three-bureau Metro 2 batch was
   * always the same coin flip, absorbed by the regeneration strikes.
   *
   * So the spread is made deterministic instead of hoped for. Offsets 0 / 2 / 4
   * over a six-line pool put the three bureaus on three different openings on
   * every attempt, and the closing is mixed differently so it does not track the
   * opening. NO NEW COPY IS INTRODUCED: every line drawn is one of the six
   * already written and already in use for that round. Only which of them a
   * given bureau draws has changed. */
  const bureauSpread = { TU: 0, EX: 2, EQ: 4 }[bureau] ?? 0;
  const open = accurate(openingFor(seed + attempt + bureauSpread, round), shape);
  const lead = accurate(instr.lead, shape);
  const close = accurate(closingFor(seed + attempt * 5 + 3 + bureauSpread * 2, round), shape);
  const demand = accurate(instr.demand, shape);
  const ask = accurate(instr.ask, shape);
  const next = accurate(instr.next, shape);
  const dateLine = opts.undated ? "[DATE — write today's date when you mail this]" : (opts.date || "");
  const name = consumerName;
  const addr = [
    identity.addressLine1,
    identity.addressLine2,
    [identity.city, identity.state, identity.zip].filter(Boolean).join(", ")
  ].filter(Boolean);
  const ssn4 = lastFourSsn(identity);

  const paragraphs = ordered.map((v) => formatViolationParagraph(v)).filter(Boolean);
  const evidenceLines = formatPriorEvidence(opts.priorResponses);
  // ── COMPLAINTS ALREADY FILED — read from the record, never assumed ──
  //
  // COMPLIANCE REVIEW REQUIRED — dispute logic.
  //
  // Fundhub mails the Round 4 CFPB complaint and the Round 5 state attorney
  // general complaint, so Round 6 may say they were filed. It may say it ONLY
  // from `priorFilings`, which the caller loads from dispute_letters rows that
  // are already status 'sent' or 'delivered' (../rounds/complaint-filing.mjs
  // loadComplaintFilings). No row, no sentence.
  //
  // Gated to R6 because R6 is the only rung that stands on the complaints. And
  // gated on the lines being non-empty, so a client whose complaints were never
  // mailed — or whose state attorney general has no postal address on file, which
  // today is every client — gets exactly the letter they got before this existed.
  const filingLines = String(round).toUpperCase() === ROUND.R6
    ? formatComplaintFilings(opts.priorFilings)
    : [];
  const evidenceBlock = (evidenceLines.length || filingLines.length)
    ? [
      ...(evidenceLines.length ? ["PRIOR BUREAU RESPONSE (evidence):", ...evidenceLines] : []),
      ...(evidenceLines.length && filingLines.length ? [""] : []),
      ...(filingLines.length ? ["COMPLAINTS ALREADY FILED (evidence):", ...filingLines] : [])
    ].join("\n")
    : null;
  const citationBlock = resolvedCitationBlock(ordered);
  const ruleIdList = ordered.map((v) => v.ruleId).join(", ");
  /* The subject line is the first thing read. It says Metro 2 only when a Metro 2
     claim is actually in the letter; otherwise it says what the letter is — an
     FCRA dispute. And it does not call itself a dispute at all when every claim
     in it says the file is correct. */
  const kind = metro2Backed ? "Metro 2" : "FCRA";
  const action = confirmationOnly ? "personal information confirmation" : "dispute";
  const reSubject = String(round).toUpperCase() === ROUND.FURNISHER
    ? `Furnisher ${kind} ${action}`
    : `Round ${instr.roundLabel || String(instr.round).replace(/^R/, "")} ${kind} ${action}`;

  const headerLines = [
    dateLine,
    "",
    name,
    ...addr
  ];
  if (ssn4) headerLines.push(`Last four of SSN: ${ssn4}`);
  headerLines.push("", bureauName(bureau), "", `Re: ${reSubject} — ${ruleIdList}`);
  const header = headerLines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");

  const withEvidence = (parts) => {
    if (!evidenceBlock) return parts;
    const out = [];
    let inserted = false;
    for (const part of parts) {
      out.push(part);
      if (!inserted && (part === open || part === lead)) {
        out.push("");
        out.push(evidenceBlock);
        inserted = true;
      }
    }
    if (!inserted) out.push("", evidenceBlock);
    return out;
  };

  let body;
  if (attempt % 3 === 1) {
    body = withEvidence([open, "", lead, "", demand, "", ...paragraphs.flatMap((p) => [p, ""]), ask]).join("\n");
  } else if (attempt % 3 === 2) {
    body = withEvidence([
      lead,
      "",
      demand,
      "",
      open,
      "",
      ask,
      "",
      ...paragraphs.flatMap((p) => [p, ""]),
      "",
      next
    ]).join("\n");
  } else {
    body = withEvidence([
      open,
      "",
      demand,
      "",
      ...paragraphs.flatMap((p) => [p, ""]),
      "",
      lead,
      "",
      next
    ]).join("\n");
  }

  return [
    header,
    "",
    body.trim(),
    "",
    "CITATIONS:",
    citationBlock,
    "",
    "CLOSING:",
    close,
    "",
    handwrittenSignOff(name)
  ].join("\n");
}

/**
 * Generate a letter that passes the variance gate against prior letters.
 */
export async function generateLetter(opts = {}) {
  const prior = opts.priorLetters || [];
  const result = await generateWithVarianceGate({
    priorLetters: prior,
    threshold: opts.threshold,
    produce: async (attempt) =>
      buildLetterText({ ...opts, attempt: attempt + (Number(opts.attemptOffset) || 0) })
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      attempts: result.attempts,
      stalled: true
    };
  }
  return {
    ok: true,
    text: result.text,
    fingerprint: result.fingerprint,
    attempts: result.attempts,
    bureau: opts.bureau,
    round: opts.round || ROUND.R1,
    ruleIds: (opts.violations || []).filter((v) => v?.ruleId).map((v) => v.ruleId),
    undated: !!opts.undated
  };
}

export { ROUND, structuralFingerprint };

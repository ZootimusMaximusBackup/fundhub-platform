// Round-specific instruction sets for letter prose. Detection stays in checks/;
// this file only tells the writer how to frame an already-decided violation list.

export const ROUND = Object.freeze({
  R1: "R1",
  R2: "R2",
  R3: "R3",
  R4: "R4",
  R5: "R5",
  R6: "R6",
  FURNISHER: "FURNISHER"
});

/**
 * Which of the three BUREAU PROSE shapes a round's letter is written in.
 *
 * COMPLIANCE REVIEW REQUIRED — dispute logic.
 *
 * THIS IS NOT THE ROUND LADDER. The ladder — what document round N actually is —
 * lives in ./catalog.mjs `ROUND_LADDER`, where R4 is the CFPB complaint and R5
 * is the state attorney general complaint. This function only picks prose, and
 * there are only three bureau prose shapes to pick from.
 *
 * Until 2026-08-28 this mapped R4→R2, R5→R3, R6→R2 and was also being read AS
 * the ladder (src/repair/round-plan.mjs), so a client past Round 3 was handed the
 * Round 2 and Round 3 bureau letters over and over and never reached the
 * complaints. The ladder moved to catalog.mjs. What is left here is the prose
 * question, and its honest answer is:
 *
 *   AFTER ROUND 3, EVERY BUREAU LETTER IS A FINAL NOTICE.
 *
 * That is still true and nothing below changes it. R4, R5 and R6 carry EXACTLY
 * the authority R3 carries — the same statutory hooks, the same 15-day deletion
 * demand, no new statute, no stronger claim, and every mention of the CFPB or a
 * state attorney general still in the future tense so no letter can assert a
 * filing this repository has no record of. The escalation past R3 is carried by
 * the CFPB and state AG complaints, which are separate documents with a separate
 * builder (src/metro2/diy/package.mjs `maybeComplaintFiles`).
 *
 * ── WHY THEY NO LONGER SHARE R3's WORDS. MEASURED 2026-09-04. ─────────────
 *
 * R4, R5 and R6 used to return the R3 pool outright, so a Round 4 bureau letter
 * was word-for-word a Round 3 bureau letter. The variance gate
 * (./variance.mjs, Jaccard over 5-character shingles, threshold 0.35) compares
 * every new letter against the last five to the same bureau, and two letters
 * built from the same six sentences score far above that. So it refused them.
 *
 * Measured on origin/main, real Postgres, the production sim seed, a repair
 * client with a damaged file, rounds run in order:
 *
 *   R1 → 5 letters   R2 → 3 letters   R3 → 3 letters
 *   R4 → 0 letters   R5 → 0 letters   R6 → 0 letters
 *
 * — every bureau `variance_gate_exhausted`. The six-round ladder the product
 * sells stopped dead at three, silently, for every client and every file shape
 * (a spotless file and a clean file were measured the same way, same result).
 *
 * The gate is not the bug and is not loosened: the threshold is untouched and
 * the strike count is untouched. What was missing is that R4, R5 and R6 had
 * nothing of their own to say. They have their own paraphrases now — the same
 * demand in different words, which is all the six lines in each R1/R2/R3 pool
 * ever were.
 */
export function promptPoolRound(round) {
  const r = String(round || ROUND.R1).toUpperCase();
  if (r === ROUND.R4 || r === ROUND.R5 || r === ROUND.R6) return ROUND.R3;
  return r;
}

/**
 * Which pool of WORDS a round draws from. Not the same question as
 * `promptPoolRound` above, and the difference is why both exist.
 *
 * `promptPoolRound` answers "which of the three letter SHAPES is this" — a
 * first dispute, a method-of-verification demand, or a final notice — and two
 * modules outside this one depend on that answer: ../../underwrite/prior-outcome.mjs
 * decides from it what a bureau has already been asked, and ../../repair/round-plan.mjs
 * prints it beside each rung of the plan. To both of them a Round 5 letter is a
 * final notice, and it still is. Nothing below changes that.
 *
 * This function answers the narrower question the writer asks: which six
 * openings and which six closings does THIS round get. R4, R5 and R6 have their
 * own now, saying what R3 says in their own words, because sharing R3's exact
 * sentences meant the variance gate refused every one of them (the measurement
 * is in the block above).
 *
 * A round with no pool of its own falls back to R1, which is what an
 * unrecognised round always did.
 */
export function prosePoolRound(round) {
  const r = String(round || ROUND.R1).toUpperCase();
  return Object.prototype.hasOwnProperty.call(ROUND, r) ? r : ROUND.R1;
}
const OPENINGS = Object.freeze({
  [ROUND.R1]: Object.freeze([
    "I am writing to dispute inaccurate information on my credit file.",
    "This letter asks you to reinvestigate the items listed below under the FCRA.",
    "The following accounts are reported inaccurately on my consumer report.",
    "I dispute the Metro 2 field defects identified below and ask you to delete or correct them.",
    "Please investigate and correct the reporting errors on my file as required by federal law.",
    "I am exercising my rights under 15 U.S.C. § 1681i regarding the items that follow."
  ]),
  [ROUND.R2]: Object.freeze([
    "I already disputed these items. They still show as verified, or you never answered.",
    "This follow-up asks for the method of verification under the FCRA.",
    "You did not tell me how you verified the items listed below after my first dispute.",
    "I am writing again because the prior reinvestigation did not describe the method of verification.",
    "The items below remain on my file without a stated method of verification.",
    "Please treat this as a Round 2 request for method of verification and furnisher contact information."
  ]),
  [ROUND.R3]: Object.freeze([
    "This is my last letter to your bureau on these items before I file with the CFPB and my state attorney general.",
    "I already asked you to reinvestigate and to describe your method of verification. The defects remain.",
    "Under FCRA section 611(a)(5)(A), delete each item you cannot verify.",
    "I demand deletion of the unverifiable items below within 15 days.",
    "Two prior disputes did not produce a reasonable investigation or a method of verification.",
    "This Round 3 letter is the last bureau notice on these Metro 2 defects. It is not a lawsuit."
  ]),
  /* ── R4, R5, R6 ────────────────────────────────────────────────────────
     Same authority as R3, different words. Each line says only what this
     repository can stand behind: the items are still on the file, because every
     claim in the letter was computed from the NEWEST stored pull; and a
     complaint is something the consumer WILL bring, never one already brought.
     Nothing here counts earlier letters — a round number is a fact of the case
     record, but "my third letter" would be a claim about what was actually
     mailed, and mailing is a separate human step. */
  [ROUND.R4]: Object.freeze([
    "The items listed below are still on my consumer file, and I am carrying them to the Consumer Financial Protection Bureau.",
    "My file still shows the items set out below. This letter asks your bureau to take them off it.",
    "Under the Fair Credit Reporting Act I ask your bureau to delete the items below, which my file still carries.",
    "This letter concerns items my consumer file still reports, and what I intend to do if it keeps reporting them.",
    "Your bureau still reports the items below about me. A federal regulator takes complaints about exactly this.",
    "I am putting your bureau on notice about the items below, which remain on the file you hold on me."
  ]),
  [ROUND.R5]: Object.freeze([
    "The items below are still on my file, and my state attorney general accepts complaints about a credit bureau that keeps reporting them.",
    "My consumer file continues to report the items set out below, and this letter is the notice I give before going to my state attorney general.",
    "Your bureau still reports the items below. I am preparing a complaint to the attorney general of my state.",
    "This letter is about items my file still carries and about the state office I will take them to.",
    "Under the Fair Credit Reporting Act, delete the items below. My state attorney general is the next place I go.",
    "I am giving your bureau written notice about the items below before I take them to my state's attorney general."
  ]),
  [ROUND.R6]: Object.freeze([
    "This is the final written notice I will send your bureau about the items below.",
    "My file still reports the items set out below, and this letter closes my direct correspondence with your bureau about them.",
    "Everything below is still on the file you hold on me. This is the last of these letters.",
    "I have nothing further to send your bureau after this letter about the items below.",
    "This letter ends what I will send you directly about the items my file still reports below.",
    "Your bureau still reports the items below. This is my closing written notice about them."
  ]),
  [ROUND.FURNISHER]: Object.freeze([
    "I am sending this direct dispute to you as the furnisher under 12 CFR 1022.43.",
    "Please investigate the Metro 2 defects below on accounts you furnish.",
    "I dispute the accuracy of the information you are reporting to the consumer reporting agencies.",
    "This letter is a direct dispute. Investigate and correct or delete what you cannot support.",
    "The items below are inaccurate as you report them. I ask you to investigate.",
    "Under 15 U.S.C. § 1681s-2(b), investigate these disputes and update the bureaus."
  ])
});

const CLOSINGS = Object.freeze({
  [ROUND.R1]: Object.freeze([
    "Please finish this reinvestigation within 30 days and send written results to the address above.",
    "I also ask for the method of verification for any item you keep on my file.",
    "If you rubber-stamp these items, my next letter will be a Round 2 method-of-verification demand.",
    "A CFPB or attorney-general complaint is reserved for later. This is not a final notice.",
    "Delete or correct each item after a real investigation, and confirm in writing.",
    "I request written confirmation of every deletion and every correction made to my file."
  ]),
  [ROUND.R2]: Object.freeze([
    "Describe the method of verification for each item under FCRA section 611(a)(7).",
    "Give me each furnisher's name, address, and telephone number under section 611(a)(6)(B)(iii).",
    "If you cannot produce that method, delete the items. I will then dispute them with the furnisher.",
    "If the furnisher also fails, I will file with the Consumer Financial Protection Bureau.",
    "This letter is not a CFPB complaint and not a lawsuit.",
    "Send the method of verification and furnisher contacts in writing to the address above."
  ]),
  [ROUND.R3]: Object.freeze([
    "Delete each unverifiable item within 15 days under FCRA section 611(a)(5)(A).",
    "This is my last letter to your bureau on these items before a CFPB and state attorney-general filing.",
    "Rights under 15 U.S.C. § 1681n and § 1681o stay reserved. This is not a lawsuit.",
    "Send written confirmation of every deletion to the address above.",
    "If these items remain after 15 days, I will file with the CFPB and my state attorney general.",
    "Do not treat this letter as a court filing. It is the last bureau notice on these items."
  ]),
  [ROUND.R4]: Object.freeze([
    "Remove what you cannot verify within 15 days under FCRA section 611(a)(5)(A).",
    "Write to me at the address above with what you did and what you removed.",
    "A complaint to the Consumer Financial Protection Bureau is what follows this letter, not a lawsuit.",
    "My rights under 15 U.S.C. § 1681n and § 1681o are not given up by sending this.",
    "Answer this in writing. A regulator's file is the alternative and I would rather not open one.",
    "Tell me in writing what you removed and what you kept, and why you kept it."
  ]),
  [ROUND.R5]: Object.freeze([
    "Take off what you cannot verify, within 15 days, under FCRA section 611(a)(5)(A).",
    "Put your answer in writing to the address at the top of this letter.",
    "My state's attorney general is where this goes next. This letter is not a lawsuit.",
    "Nothing in this letter gives up my rights under 15 U.S.C. § 1681n or § 1681o.",
    "Write back and name what came off my file and what stayed on it.",
    "Fifteen days, in writing, to the address above. After that I go to my state."
  ]),
  [ROUND.R6]: Object.freeze([
    "Within 15 days, remove what you cannot verify, under FCRA section 611(a)(5)(A).",
    "Send your written answer to the address at the top of this letter.",
    "This is a letter, not a court filing, and not a claim that anything has been filed anywhere.",
    "My rights under 15 U.S.C. § 1681n and § 1681o remain mine after this letter.",
    "Put in writing what came off the file and what did not.",
    "I have said what I have to say to your bureau. Answer it in writing."
  ]),
  [ROUND.FURNISHER]: Object.freeze([
    "Investigate each item and tell the bureaus the outcome in writing.",
    "If you cannot support an item with original records, stop reporting it.",
    "If you fail, I will file with the CFPB.",
    "Send written results to the address above.",
    "This is a direct dispute, not a bureau letter and not a lawsuit.",
    "Correct or delete what you cannot verify, and confirm in writing."
  ])
});

function poolFor(table, round) {
  const key = prosePoolRound(round);
  return table[key] || table[ROUND.R1];
}

export function openingFor(seed = 0, round = ROUND.R1) {
  const pool = poolFor(OPENINGS, round);
  return pool[Math.abs(Number(seed) || 0) % pool.length];
}

export function closingFor(seed = 0, round = ROUND.R1) {
  const pool = poolFor(CLOSINGS, round);
  return pool[Math.abs(Number(seed) || 0) % pool.length];
}

export function roundInstructions(round) {
  const actual = String(round || ROUND.R1).toUpperCase();
  const pool = prosePoolRound(actual);
  const label = actual === ROUND.FURNISHER
    ? "furnisher"
    : (/^R(\d+)$/.exec(actual)?.[1] || "1");

  switch (pool) {
    case ROUND.R2:
      return {
        round: actual,
        roundLabel: label,
        hooks: ["FCRA § 611(a)(7)", "FCRA § 611(a)(6)(B)(iii)", "15 U.S.C. § 1681s-2(b)"],
        tone: "MOV demand + furnisher escalation",
        lead: "I already sent a prior dispute. Your response marked items as verified, or you did not answer, without telling me the method of verification.",
        demand: "Under FCRA section 611(a)(7), describe the method of verification for each item — who you contacted, what records they sent, and what you compared. Under section 611(a)(6)(B)(iii), give me each furnisher's name, address, and telephone number.",
        ask: "If you cannot produce that method, delete the items. I will then dispute the same items with the furnisher.",
        next: "If the furnisher also fails, I will file with the Consumer Financial Protection Bureau. This letter is not a CFPB complaint and not a lawsuit."
      };
    case ROUND.R3:
      return {
        round: actual,
        roundLabel: label,
        hooks: ["FCRA § 611(a)(5)(A)", "15 U.S.C. § 1681n", "15 U.S.C. § 1681o"],
        tone: "Last bureau letter / 15-day deletion demand",
        lead: "This is a further notice to your bureau on these items before I file with the CFPB and my state attorney general.",
        demand: "Under FCRA section 611(a)(5)(A), delete each item you cannot verify. I demand deletion within 15 days of this letter.",
        ask: "Send written confirmation of every deletion to the address above.",
        next: "Rights under 15 U.S.C. § 1681n and § 1681o stay reserved. This is not a lawsuit and not a CFPB filing. Those come next if you still fail."
      };
    /* Same hooks as R3, same 15-day deletion demand, said differently. The
       CFPB and the state attorney general are named the way R3 names them —
       as somewhere the consumer WILL go, never somewhere they have been. */
    case ROUND.R4:
      return {
        round: actual,
        roundLabel: label,
        hooks: ["FCRA § 611(a)(5)(A)", "15 U.S.C. § 1681n", "15 U.S.C. § 1681o"],
        tone: "Bureau notice alongside the CFPB complaint",
        lead: "My consumer file still reports the items set out below.",
        demand: "FCRA section 611(a)(5)(A) requires you to delete an item you cannot verify. Do that within 15 days of this letter, for every item below you cannot stand behind.",
        ask: "Tell me in writing what came off my file and what stayed on it.",
        next: "The Consumer Financial Protection Bureau is where I take this next. Nothing in this letter is a lawsuit, and nothing in it says a complaint has already been filed. My rights under 15 U.S.C. § 1681n and § 1681o stay mine."
      };
    case ROUND.R5:
      return {
        round: actual,
        roundLabel: label,
        hooks: ["FCRA § 611(a)(5)(A)", "15 U.S.C. § 1681n", "15 U.S.C. § 1681o"],
        tone: "Bureau notice alongside the state attorney general complaint",
        lead: "The items set out below have not come off the file your bureau holds on me.",
        demand: "Delete every item below that you cannot verify, within 15 days, as FCRA section 611(a)(5)(A) requires.",
        ask: "Put your answer in writing and send it to the address at the top of this letter.",
        next: "My state's attorney general is the next office I bring this to. This letter is not a lawsuit and claims no filing has been made. Rights under 15 U.S.C. § 1681n and § 1681o stay reserved."
      };
    case ROUND.R6:
      return {
        round: actual,
        roundLabel: label,
        hooks: ["FCRA § 611(a)(5)(A)", "15 U.S.C. § 1681n", "15 U.S.C. § 1681o"],
        tone: "Closing bureau notice",
        lead: "What is set out below is still on the file your bureau holds on me.",
        demand: "Under FCRA section 611(a)(5)(A) an item you cannot verify comes off. Take the items below off within 15 days unless you can verify them.",
        ask: "Write back and say what you removed and what you kept.",
        next: "This is the last of these letters from me to your bureau. It is not a court filing and it does not say that anything has been filed anywhere. My rights under 15 U.S.C. § 1681n and § 1681o are unaffected."
      };
    case ROUND.FURNISHER:
      return {
        round: ROUND.FURNISHER,
        roundLabel: "furnisher",
        hooks: ["12 CFR 1022.43", "15 U.S.C. § 1681s-2(b)"],
        tone: "Direct dispute to furnisher",
        lead: "I am submitting this direct dispute under 12 CFR 1022.43.",
        demand: "Investigate each item and correct or delete what you cannot support with original records.",
        ask: "Tell the credit bureaus the outcome in writing.",
        next: "If you fail, I will file with the CFPB. This is not a lawsuit."
      };
    case ROUND.R1:
    default:
      return {
        round: ROUND.R1,
        roundLabel: label,
        hooks: ["15 U.S.C. § 1681e(b)", "FCRA § 611(a)(1)"],
        tone: "30-day reinvestigation + method of verification request",
        lead: "The items below have Metro 2 reporting defects that make my file inaccurate or misleading.",
        demand: "Please reinvestigate each item within 30 days under FCRA section 611(a)(1). I also ask for the method of verification for any item you keep on the file.",
        ask: "Delete or correct each item after a reasonable investigation, and send written results to the address above.",
        next: "If you rubber-stamp these items without a real investigation, my next letter will be a Round 2 method-of-verification demand. A CFPB or attorney-general complaint is reserved for later. This is not a final notice."
      };
  }
}

/** Seeded permutation of violation order within the same severity tier. */
export function rotateViolations(violations, seed = 0) {
  const bySev = { deletion: [], strong: [], moderate: [], supporting: [] };
  for (const v of violations || []) {
    const k = bySev[v.severity] ? v.severity : "supporting";
    bySev[k].push(v);
  }
  const out = [];
  for (const tier of ["deletion", "strong", "moderate", "supporting"]) {
    const arr = [...bySev[tier]];
    // deterministic rotate
    const n = arr.length;
    if (n > 1) {
      const offset = Math.abs(Number(seed) || 0) % n;
      out.push(...arr.slice(offset), ...arr.slice(0, offset));
    } else {
      out.push(...arr);
    }
  }
  return out;
}

export { OPENINGS, CLOSINGS };

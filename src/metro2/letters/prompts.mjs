// Round-specific instruction sets for letter prose. Detection stays in checks/;
// this file only tells the writer how to frame an already-decided violation list.

export const ROUND = Object.freeze({
  R1: "R1",
  R2: "R2",
  R3: "R3",
  FURNISHER: "FURNISHER"
});

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
  const key = String(round || ROUND.R1).toUpperCase();
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
  switch (String(round || "").toUpperCase()) {
    case ROUND.R2:
      return {
        round: ROUND.R2,
        roundLabel: "2",
        hooks: ["FCRA § 611(a)(7)", "FCRA § 611(a)(6)(B)(iii)", "15 U.S.C. § 1681s-2(b)"],
        tone: "MOV demand + furnisher escalation",
        lead: "I already sent a Round 1 dispute. Your response marked items as verified, or you did not answer, without telling me the method of verification.",
        demand: "Under FCRA section 611(a)(7), describe the method of verification for each item — who you contacted, what records they sent, and what you compared. Under section 611(a)(6)(B)(iii), give me each furnisher's name, address, and telephone number.",
        ask: "If you cannot produce that method, delete the items. I will then dispute the same items with the furnisher.",
        next: "If the furnisher also fails, I will file with the Consumer Financial Protection Bureau. This letter is not a CFPB complaint and not a lawsuit."
      };
    case ROUND.R3:
      return {
        round: ROUND.R3,
        roundLabel: "3",
        hooks: ["FCRA § 611(a)(5)(A)", "15 U.S.C. § 1681n", "15 U.S.C. § 1681o"],
        tone: "Last bureau letter / 15-day deletion demand",
        lead: "This is my last letter to your bureau on these items before I file with the CFPB and my state attorney general.",
        demand: "Under FCRA section 611(a)(5)(A), delete each item you cannot verify. I demand deletion within 15 days of this letter.",
        ask: "Send written confirmation of every deletion to the address above.",
        next: "Rights under 15 U.S.C. § 1681n and § 1681o stay reserved. This is not a lawsuit and not a CFPB filing. Those come next if you still fail."
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
        roundLabel: "1",
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

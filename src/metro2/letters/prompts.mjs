// Round-specific instruction sets for letter prose. Detection stays in checks/;
// this file only tells the writer how to frame an already-decided violation list.

export const ROUND = Object.freeze({
  R1: "R1",
  R2: "R2",
  R3: "R3",
  FURNISHER: "FURNISHER"
});

const OPENINGS = Object.freeze([
  "I am writing to dispute inaccurate information on my credit file.",
  "This letter demands a reinvestigation of the items listed below under the FCRA.",
  "The following accounts are reported inaccurately on my consumer report.",
  "I dispute the Metro 2 field defects identified below and demand deletion or correction.",
  "Please investigate and correct the reporting errors on my file as required by federal law.",
  "I am exercising my rights under 15 U.S.C. § 1681i regarding the items that follow."
]);

const CLOSINGS = Object.freeze([
  "Please complete your investigation within 30 days and send written results to the address above.",
  "I expect deletion of unverifiable items and written confirmation of your findings.",
  "Respond in writing with the method of verification for each item you claim to have verified.",
  "If you cannot verify these items with original documentation, delete them immediately.",
  "Failure to conduct a reasonable investigation will leave me no choice but to escalate.",
  "I request written confirmation of every deletion and every correction made to my file."
]);

export function openingFor(seed = 0) {
  return OPENINGS[Math.abs(Number(seed) || 0) % OPENINGS.length];
}

export function closingFor(seed = 0) {
  return CLOSINGS[Math.abs(Number(seed) || 0) % CLOSINGS.length];
}

export function roundInstructions(round) {
  switch (String(round || "").toUpperCase()) {
    case ROUND.R2:
      return {
        round: ROUND.R2,
        hooks: ["§1681i(a)(6)(B)(iii)", "§1681i(a)(7)", "§1681s-2(b)", "FDCPA §1692g"],
        tone: "MOV demand + furnisher escalation",
        lead: "Your prior response marked items as verified without providing the method of verification."
      };
    case ROUND.R3:
      return {
        round: ROUND.R3,
        hooks: ["§1681i(a)(5)(A)", "§1681n", "§1681o", "FDCPA §1692k"],
        tone: "Final notice / willful noncompliance",
        lead: "This is a final notice regarding willful noncompliance with the FCRA."
      };
    case ROUND.FURNISHER:
      return {
        round: ROUND.FURNISHER,
        hooks: ["12 CFR 1022.43", "§1681s-2(b)"],
        tone: "Direct dispute to furnisher",
        lead: "I am submitting this direct dispute under 12 CFR 1022.43."
      };
    case ROUND.R1:
    default:
      return {
        round: ROUND.R1,
        hooks: ["§1681e(b)", "§1681i(a)(1)", "§1681i(a)(5)"],
        tone: "Metro 2 compliance dispute",
        lead: "The items below contain Metro 2 reporting defects that make the file inaccurate or materially misleading."
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

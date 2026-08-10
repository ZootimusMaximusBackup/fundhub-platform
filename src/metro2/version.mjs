// Which edition of the knowledge base this engine was built against.
//
// WHY THIS FILE EXISTS. Every letter this system generates makes claims that
// trace back to a code table (Exhibit 4, 7, 8, 10, 11) and a statute. Those
// tables change: the CDIA reissues the Credit Reporting Resource Guide roughly
// every two years, and codes go obsolete between editions (Status 05 did, in
// April 2022; ECOA 0/4/6 did, in September 2003). When a bureau pushes back on
// a letter mailed eighteen months ago, the question is "which edition were you
// reading?" — so the answer is stamped on every violation the engine produces.
//
// Bump KB_VERSION and KB_DATE together, in the same commit as the rule-table
// edit that a new edition forces. Never bump one alone.

/** Version string printed inside the knowledge base document itself. */
export const KB_VERSION = "1.0";

/** Date the knowledge base edition was built. */
export const KB_DATE = "2026-04-24";

/** Repo-relative path to the human source of truth. Agents do not edit it. */
export const KB_PATH = "docs/metro2/METRO2_MASTER_KNOWLEDGE_BASE.md";

/** What the knowledge base was compiled from, per its own header. */
export const KB_SOURCES = [
  "2020 CDIA Credit Reporting Resource Guide (CRRG)",
  "15 U.S.C. § 1681 et seq.",
  "12 CFR Part 1022",
  "federal case law"
];

/** One-line stamp for attaching to generated artefacts and audit records. */
export const KB_STAMP = `METRO2_MASTER_KNOWLEDGE_BASE v${KB_VERSION} (${KB_DATE})`;

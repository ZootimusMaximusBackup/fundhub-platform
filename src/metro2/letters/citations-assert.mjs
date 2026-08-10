// Assert citation blocks stay byte-identical to the resolved rule citations.

import { citationsFor } from "../rules/citations.mjs";

function linesFrom(citations) {
  if (!citations) return [];
  if (Array.isArray(citations)) return citations.map((l) => String(l).trim()).filter(Boolean);
  const out = [];
  for (const line of citations.statutes || []) out.push(String(line).trim());
  for (const line of citations.cases || citations.caseLaw || []) out.push(String(line).trim());
  return out.filter(Boolean);
}

/** Canonical citation lines for a set of violations, sorted, one per line. */
export function resolvedCitationBlock(violations) {
  const lines = new Set();
  for (const v of violations || []) {
    if (!v?.ruleId) continue;
    for (const line of linesFrom(v.citations || citationsFor(v.ruleId))) lines.add(line);
  }
  return [...lines].sort().join("\n");
}

export function extractCitationBlock(letterText) {
  const text = String(letterText || "");
  const m = /(?:^|\n)CITATIONS:\s*\n([\s\S]*?)(?:\n\n|\nCLOSING:|\nSincerely|\nRespectfully|$)/i.exec(text);
  if (!m) return "";
  return m[1]
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .sort()
    .join("\n");
}

export function assertCitationsByteIdentical(letterText, violations) {
  const expected = resolvedCitationBlock(violations);
  const got = extractCitationBlock(letterText);
  if (expected === got) return { ok: true, expected, got };
  return { ok: false, expected, got, reason: "citation_drift" };
}

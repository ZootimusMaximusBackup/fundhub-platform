// One-shot: append batch-2 fan-out rows (B, C, D) to the board Findings table,
// then append the four journey sections in order. APPEND ONLY.
import fs from "node:fs";
const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const JOURNAL = process.argv[2];
const BOARD = `${ROOT}/docs/workflows/fable-audit-2026-08-16.md`;
const ORDER = ["role-funding-advisor", "role-inquiry-remover", "role-sales-manager"];
const lines = fs.readFileSync(JOURNAL, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const byJourney = new Map();
for (const l of lines) if (l.type === "result" && l.result?.journey) byJourney.set(l.result.journey, l.result);
const missing = ORDER.filter((j) => !byJourney.has(j));
if (missing.length) { console.error("missing results:", missing); process.exit(1); }
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n+/g, " ").trim();
let out = "";
for (const j of ORDER) {
  const r = byJourney.get(j);
  for (const row of r.rows) {
    out += `| ${j} | ${cell(row.step)} | ${cell(row.expected)} | ${cell(row.observed)} | ${cell(row.evidence)} | ${cell(row.severity)} | ${cell(r.model)} |\n`;
  }
}
// sections, in A..D order
out += "\n";
for (const j of ["role-closer", ...ORDER]) {
  const sec = fs.readFileSync(`${ROOT}/docs/workflows/e2e-verify-run5-evidence/${j}/section.md`, "utf8").trimEnd();
  out += sec + "\n\n";
}
out += "---\n\n**Batch 2 complete — 2026-08-17T" + new Date().toISOString().slice(11, 16) + "Z.** Four journeys walked (role-closer, role-funding-advisor, role-inquiry-remover, role-sales-manager). Auditor stopped here; nothing fixed. Chris names the first Fixer target.\n";
fs.appendFileSync(BOARD, out);
console.log("appended", out.split("\n").length, "lines; rows:", ORDER.map((j) => `${j}=${byJourney.get(j).rows.length}`).join(", "));

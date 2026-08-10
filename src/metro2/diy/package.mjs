// DIY dispute package — all rounds upfront, conditional undated R2/R3, batch variance.

import { generateLetter, buildLetterText, ROUND } from "../letters/generate.mjs";
import { assertBatchVariance } from "../letters/variance.mjs";
import { renderLetterPdf } from "../letters/render.mjs";
import { assertReadyToSend } from "../../repair/safety.mjs";

function coverSheet({ round, bureau, items, waitDays = 30 }) {
  const list = (items || [])
    .map((it) => `  • ${it.creditor || "Creditor"} — acct ending ${it.account_last4 || "????"}`)
    .join("\n");
  return [
    `ROUND ${String(round).replace(/^R/, "")} — ${bureau}`,
    "",
    "SEND THIS LETTER ONLY IF:",
    `The bureau responded to your prior dispute and said any of these items were "verified" or "remains":`,
    "",
    list || "  • (items listed in the letter)",
    "",
    "DO NOT SEND IF:",
    "• The bureau deleted all of these items, or",
    "• You have not received a response yet, or",
    `• It has been less than ${waitDays} days since the prior round`,
    "",
    "BEFORE MAILING:",
    "1. Write today's date at the top",
    "2. Cross out any item already deleted",
    "3. Sign by hand",
    "4. Enclose: photo ID, proof of address"
  ].join("\n");
}

function decisionTree() {
  return [
    "DECISION TREE",
    "",
    "All items deleted → stop. Do not send Round 2 or 3. Celebrate and re-check your scores.",
    "Some deleted / some verified → send Round 2 only for the verified items (cross out the rest).",
    "All verified → send Round 2 MOV demand.",
    "No response after 30 days + mail time → Round 2 with late-response argument; keep your certified-mail receipt."
  ].join("\n");
}

/**
 * Build a full DIY package from violations grouped by bureau.
 * R2/R3 are undated + conditional. Batch variance required or package holds.
 */
export async function buildDiyPackage({
  violationsByBureau = {},
  identity,
  seed,
  priorByBureau = {},
  furnishers = []
}) {
  const letters = [];
  const documents = [];

  documents.push({ path: "01-START-HERE-instructions.pdf.txt", text: instructionsDoc() });
  documents.push({ path: "02-decision-tree.pdf.txt", text: decisionTree() });

  for (const [bureau, violations] of Object.entries(violationsByBureau)) {
    if (!violations?.length) continue; // never generate for a bureau with zero findings

    const metro = violations.filter((v) => !["M2-031", "M2-032", "M2-033", "M2-034", "M2-035", "M2-036", "M2-037", "M2-038"].includes(v.ruleId));
    const personal = violations.filter((v) => ["M2-031", "M2-032", "M2-033", "M2-034", "M2-035", "M2-036", "M2-037", "M2-038"].includes(v.ruleId));

    for (const [round, set, folder] of [
      [ROUND.R1, metro, "03-round-1"],
      [ROUND.R1, personal, "03-round-1"]
    ]) {
      if (!set.length) continue;
      const kind = set === personal ? "personal-info-inquiries" : "metro2";
      const gen = await generateLetter({
        violations: set,
        identity,
        bureau,
        round,
        seed: `${seed}:${bureau}:${kind}:R1`,
        priorLetters: [],
        undated: false
      });
      if (!gen.ok) return { ok: false, reason: gen.reason, stalled: true };
      letters.push({ ...gen, bureau, round, folder, filename: `${folder}/${bureau.toLowerCase()}-${kind}.pdf` });
    }

    // Conditional R2 / R3
    for (const round of [ROUND.R2, ROUND.R3]) {
      const set = metro.length ? metro : violations;
      const folder = round === ROUND.R2 ? "04-round-2-CONDITIONAL" : "05-round-3-CONDITIONAL";
      const cover = coverSheet({
        round,
        bureau,
        items: set.map((v) => ({ creditor: v.subject || v.creditor, account_last4: v.account_last4 })),
        waitDays: round === ROUND.R2 ? 30 : 15
      });
      documents.push({ path: `${folder}/COVER-${bureau}.txt`, text: cover });
      const gen = await generateLetter({
        violations: set,
        identity,
        bureau,
        round,
        seed: `${seed}:${bureau}:${round}:v2`,
        attemptOffset: round === ROUND.R2 ? 1 : 2,
        priorLetters: [],
        undated: true
      });
      if (!gen.ok) return { ok: false, reason: gen.reason, stalled: true };
      letters.push({
        ...gen,
        bureau,
        round,
        folder,
        filename: `${folder}/${bureau.toLowerCase()}-${round.toLowerCase()}.pdf`,
        conditional: true
      });
    }
  }

  // Direct furnisher letters for deletion-tier
  let fi = 0;
  for (const f of furnishers) {
    const set = (f.violations || []).filter((v) => v.severity === "deletion" && v.ruleId);
    if (!set.length) continue;
    const gen = await generateLetter({
      violations: set,
      identity,
      bureau: f.bureau || "EX",
      round: ROUND.FURNISHER,
      seed: `${seed}:furnisher:${fi}`,
      attemptOffset: 3 + fi,
      priorLetters: [],
      undated: false
    });
    fi++;
    if (!gen.ok) return { ok: false, reason: gen.reason, stalled: true };
    letters.push({
      ...gen,
      filename: `03-round-1/furnisher-${(f.name || "creditor").toLowerCase().replace(/\s+/g, "-")}.pdf`
    });
  }

  // Intra-batch + prior window. On failure, regenerate the later letter with a bumped seed (2 strikes).
  let batch = assertBatchVariance(
    letters.map((l) => ({ text: l.text, bureau: l.bureau })),
    0.45,
    priorByBureau
  );
  for (let strike = 0; !batch.ok && strike < 2; strike++) {
    const idx = batch.b;
    const L = letters[idx];
    if (!L) break;
    const regen = await generateLetter({
      violations: (violationsByBureau[L.bureau] || []).filter((v) => L.ruleIds?.includes(v.ruleId)),
      identity,
      bureau: L.bureau,
      round: L.round,
      seed: `${seed}:regen:${idx}:${strike}`,
      attemptOffset: 5 + strike * 3 + idx,
      priorLetters: [],
      undated: L.conditional === true
    });
    if (!regen.ok) return { ok: false, reason: regen.reason, stalled: true };
    letters[idx] = { ...L, ...regen, filename: L.filename, conditional: L.conditional, folder: L.folder };
    batch = assertBatchVariance(
      letters.map((l) => ({ text: l.text, bureau: l.bureau })),
      0.45,
      priorByBureau
    );
  }
  if (!batch.ok) return { ok: false, reason: "batch_variance", detail: batch, stalled: true };

  for (const L of letters) {
    const safe = assertReadyToSend({ letterText: L.text, violations: violationsForLetter(L, violationsByBureau) });
    if (!safe.ok) return { ok: false, reason: safe.reason, stalled: true, detail: safe };
  }

  // Render PDFs
  const files = [];
  for (const doc of documents) {
    files.push({ path: doc.path, text: doc.text });
  }
  for (const L of letters) {
    const pdf = await renderLetterPdf({ text: L.text, identity });
    files.push({
      path: L.filename,
      pdf: Buffer.from(pdf),
      text: L.text,
      fingerprint: L.fingerprint,
      ruleIds: L.ruleIds
    });
  }

  files.push({ path: "08-round-tracker.pdf.txt", text: roundTrackerTemplate() });

  return {
    ok: true,
    files,
    letterCount: letters.length,
    events: {
      ready: "diy.package.ready",
      delivered: "diy.package.delivered"
    }
  };
}

function violationsForLetter(letter, byBureau) {
  const all = byBureau[letter.bureau] || Object.values(byBureau).flat();
  return all.filter((v) => letter.ruleIds?.includes(v.ruleId));
}

function instructionsDoc() {
  return [
    "HOW TO USE THIS PACKAGE",
    "",
    "Mail certified with return receipt. Keep the receipt — it starts the 30-day clock.",
    "One envelope per bureau. Never combine.",
    "Keep every response. Photograph it the day it arrives.",
    "Do not use a PO box return address. Use the home address on your ID.",
    "Sign by hand, in ink.",
    "Wait the full 30 days plus mail time before Round 2.",
    "Metro 2 disputes correct inaccurate reporting. Accurate derogatories may be corrected rather than deleted."
  ].join("\n");
}

function roundTrackerTemplate() {
  return [
    "ROUND TRACKER",
    "Round | Bureau | Date mailed | Certified receipt # | Response date | Outcome",
    "R1 |  |  |  |  |",
    "R2 |  |  |  |  |",
    "R3 |  |  |  |  |"
  ].join("\n");
}

export { coverSheet, decisionTree, buildLetterText };

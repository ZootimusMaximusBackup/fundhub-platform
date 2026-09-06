// DIY dispute package — all rounds upfront, conditional undated R2/R3, batch variance.

import { generateLetter, buildLetterText, ROUND, hasMetro2Claim } from "../letters/generate.mjs";
import { assertBatchVariance } from "../letters/variance.mjs";
import { renderLetterPdf } from "../letters/render.mjs";
import { splitViolations, LETTER_TYPES } from "../letters/catalog.mjs";
import { buildCfpbComplaint, buildStateAgComplaint, renderComplaintPdf } from "../letters/complaints.mjs";
import {
  buildFurnisherValidationLetter,
  renderFurnisherValidationPdf
} from "../letters/furnisher-validation.mjs";
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
    "No response after 30 days + mail time → Round 2 with late-response argument; keep your certified-mail receipt.",
    "Round 3 still on the report → file the CFPB complaint, then the state AG complaint. Sign the declaration on each. Do not file them with Round 1."
  ].join("\n");
}

function streetKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function dropCurrentStreet(items, identity) {
  const current = streetKey(identity?.addressLine1);
  if (!current) return items;
  return items.filter((v) => {
    const label = streetKey(v.subject || v.observed?.address || "");
    return !label || !label.startsWith(current);
  });
}

function accountsFromPack(violationsByBureau) {
  const accounts = [];
  for (const [bureau, list] of Object.entries(violationsByBureau || {})) {
    for (const v of list || []) {
      if (!v?.ruleId) continue;
      accounts.push({
        creditor: v.creditor || v.subject || "Creditor",
        accountType: bureau,
        amount: v.amount ?? null,
        originalCreditor: v.originalCreditor || null,
        fieldViolations: [{ ruleId: v.ruleId, field: v.field, reason: v.reason }]
      });
    }
  }
  return accounts;
}

/*
 * The R1 line is the only sentence in this timeline that names Metro 2, and the
 * complaint carrying it is signed under penalty of perjury. A pack built only
 * from derogatory-item claims (../diy/derogatory.mjs) mailed no Metro 2 dispute,
 * so it gets the plain wording. Same predicate as the letters and the DISPUTED
 * ACCOUNTS heading — ../letters/generate.mjs#hasMetro2Claim.
 */
function blankTimeline({ metro2Backed = true } = {}) {
  return [
    {
      round: "R1",
      summary: metro2Backed
        ? "Initial Metro 2 dispute via certified mail."
        : "Initial dispute via certified mail."
    },
    { round: "R2", summary: "Method of verification / FCRA escalation." },
    { round: "R3", summary: "Final bureau notice." }
  ];
}

function complaintCover() {
  return [
    "SEND THESE COMPLAINTS ONLY IF:",
    "Round 3 is done and the disputed items are still on the report.",
    "",
    "DO NOT FILE WITH ROUND 1.",
    "",
    "BEFORE FILING:",
    "1. Write today's date",
    "2. Sign the perjury declaration by hand — onboarding consent is not this signature",
    "3. Attach Round 1–3 letters and certified-mail receipts",
    "4. File CFPB first or file CFPB and the state AG at the same time"
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
  furnishers = [],
  hasAuthorization = false,
  datedComplaints = false
}) {
  if (datedComplaints && !hasAuthorization) {
    return { ok: false, reason: "dispute_authorization_required", stalled: true };
  }

  const letters = [];
  const documents = [];
  const extras = [];

  documents.push({ path: "01-START-HERE-instructions.pdf.txt", text: instructionsDoc() });
  documents.push({ path: "02-decision-tree.pdf.txt", text: decisionTree() });

  for (const [bureau, violations] of Object.entries(violationsByBureau)) {
    if (!violations?.length) continue; // never generate for a bureau with zero findings

    const split = splitViolations(violations);
    const metro = split.tradeline;
    const personal = dropCurrentStreet(split.personal, identity);
    const inquiry = split.inquiry;

    for (const [kind, set] of [
      ["metro2", metro],
      ["personal-info", personal],
      ["inquiry", inquiry]
    ]) {
      if (!set.length) continue;
      const folder = "03-round-1";
      const gen = await generateLetter({
        violations: set,
        identity,
        bureau,
        round: ROUND.R1,
        seed: `${seed}:${bureau}:${kind}:R1`,
        priorLetters: [],
        undated: false
      });
      if (!gen.ok) return { ok: false, reason: gen.reason, stalled: true };
      letters.push({
        ...gen,
        bureau,
        round: ROUND.R1,
        folder,
        filename: `${folder}/${bureau.toLowerCase()}-${kind}.pdf`,
        skipVariance: kind !== "metro2"
      });
    }

    // Conditional R2 / R3 — tradeline Metro 2 only. Not a final notice on Round 1.
    if (metro.length) {
      for (const round of [ROUND.R2, ROUND.R3]) {
        const folder = round === ROUND.R2 ? "04-round-2-CONDITIONAL" : "05-round-3-CONDITIONAL";
        const cover = coverSheet({
          round,
          bureau,
          items: metro.map((v) => ({ creditor: v.subject || v.creditor, account_last4: v.account_last4 })),
          waitDays: round === ROUND.R2 ? 30 : 15
        });
        documents.push({ path: `${folder}/COVER-${bureau}.txt`, text: cover });
        const gen = await generateLetter({
          violations: metro,
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
      filename: `03-round-1/furnisher-${slugName(f.name)}.pdf`
    });
  }

  for (const f of furnishers) {
    if (!f?.name && !f?.addressLines?.length) continue;
    const built = buildFurnisherValidationLetter({
      identity,
      furnisher: { name: f.name, addressLines: f.addressLines },
      account: {
        creditor: f.name,
        last4: f.account_last4 || f.last4,
        originalCreditor: f.originalCreditor,
        accountType: f.accountType
      }
    });
    const pdf = await renderFurnisherValidationPdf({
      identity,
      furnisher: { name: f.name, addressLines: f.addressLines },
      account: {
        creditor: f.name,
        last4: f.account_last4 || f.last4,
        originalCreditor: f.originalCreditor,
        accountType: f.accountType
      }
    });
    extras.push({
      path: `03-round-1/furnisher-validation-${slugName(f.name)}.pdf`,
      text: built.text,
      pdf: Buffer.from(pdf)
    });
  }

  // Intra-batch + prior window. Personal-info and inquiry letters skip this
  // check — they share a header with the Metro 2 letter on purpose.
  const varianceTargets = letters
    .map((l, index) => ({ l, index }))
    .filter(({ l }) => !l.skipVariance);
  let batch = assertBatchVariance(
    varianceTargets.map(({ l }) => ({ text: l.text, bureau: l.bureau })),
    0.45,
    priorByBureau
  );
  for (let strike = 0; !batch.ok && strike < 2; strike++) {
    const tracked = varianceTargets[batch.b];
    const idx = tracked?.index;
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
    letters[idx] = {
      ...L,
      ...regen,
      filename: L.filename,
      conditional: L.conditional,
      folder: L.folder,
      skipVariance: L.skipVariance
    };
    const again = letters
      .map((l, index) => ({ l, index }))
      .filter(({ l }) => !l.skipVariance);
    batch = assertBatchVariance(
      again.map(({ l }) => ({ text: l.text, bureau: l.bureau })),
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

  for (const extra of extras) {
    files.push(extra);
  }

  const complaintFiles = await maybeComplaintFiles({
    identity,
    violationsByBureau,
    datedComplaints
  });
  if (!complaintFiles.ok) return complaintFiles;
  files.push(...complaintFiles.files);

  files.push({ path: "08-round-tracker.pdf.txt", text: roundTrackerTemplate() });

  return {
    ok: true,
    files,
    letterCount: letters.length + extras.length + complaintFiles.files.filter((f) => f.pdf).length,
    events: {
      ready: "diy.package.ready",
      delivered: "diy.package.delivered"
    }
  };
}

function slugName(name) {
  return String(name || "creditor")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "creditor";
}

/** The folder the two complaints always ship in. The name is the warning. */
export const COMPLAINT_FOLDER = "06-complaints-CONDITIONAL";

/**
 * The ONLY place the CFPB / state AG complaint pair is built.
 *
 * COMPLIANCE REVIEW REQUIRED — credit-repair messaging.
 *
 * The cover sheet is part of the return value, not an optional extra. Both
 * complaints are sworn under penalty of perjury and are out of order before
 * Round 3, so the sheet that says "DO NOT FILE WITH ROUND 1" travels with the
 * documents wherever they go. Any caller that wants these two PDFs calls this
 * and ships everything it returns. Do not re-implement it elsewhere.
 */
export async function maybeComplaintFiles({
  identity,
  violationsByBureau,
  datedComplaints
}) {
  const accounts = accountsFromPack(violationsByBureau);
  if (!accounts.length) return { ok: true, files: [] };

  const undated = !datedComplaints;
  const timeline = blankTimeline({
    metro2Backed: Object.values(violationsByBureau || {}).some((list) => hasMetro2Claim(list))
  });
  const files = [
    { path: `${COMPLAINT_FOLDER}/COVER.txt`, text: complaintCover() }
  ];

  const cfpbText = buildCfpbComplaint({ identity, accounts, timeline, undated });
  const agText = buildStateAgComplaint({ identity, accounts, timeline, undated });
  const [cfpbPdf, agPdf] = await Promise.all([
    renderComplaintPdf(cfpbText, identity),
    renderComplaintPdf(agText, identity)
  ]);
  files.push({
    path: `${COMPLAINT_FOLDER}/cfpb-complaint.pdf`,
    type: LETTER_TYPES.CFPB_COMPLAINT,
    text: cfpbText,
    pdf: Buffer.from(cfpbPdf)
  });
  files.push({
    path: `${COMPLAINT_FOLDER}/state-ag-complaint.pdf`,
    type: LETTER_TYPES.STATE_AG_COMPLAINT,
    text: agText,
    pdf: Buffer.from(agPdf)
  });
  return { ok: true, files };
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
    "Do not file the CFPB or state AG complaints until Round 3 failed. Sign the declaration on those pages — the onboarding box is not that signature.",
    "Metro 2 disputes correct inaccurate reporting. Accurate derogatories may be corrected rather than deleted."
  ].join("\n");
}

function roundTrackerTemplate() {
  return [
    "ROUND TRACKER",
    "Round | Bureau | Date mailed | Certified receipt # | Response date | Outcome",
    "R1 |  |  |  |  |",
    "R2 |  |  |  |  |",
    "R3 |  |  |  |  |",
    "CFPB |  |  |  |  |",
    "State AG |  |  |  |  |"
  ].join("\n");
}

export { coverSheet, decisionTree, buildLetterText };

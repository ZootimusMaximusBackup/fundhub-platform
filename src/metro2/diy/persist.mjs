// Save DIY pack PDFs into the documents registry.
// COMPLIANCE REVIEW REQUIRED — dispute letters, CFPB/AG, furnisher validation.

import { KINDS, titleFor } from "../../documents/kinds.mjs";
import { storeAndRegister } from "../../documents/register.mjs";

function subtypeForPath(filePath) {
  const s = String(filePath || "").toLowerCase();
  if (s.includes("cfpb-complaint")) return "cfpb_complaint";
  if (s.includes("state-ag-complaint")) return "state_ag_complaint";
  if (s.includes("furnisher-validation")) return "furnisher_validation";
  return "metro2_dispute_letter_pack";
}

function discriminatorFor(filePath) {
  return String(filePath || "letter.pdf")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .slice(0, 180);
}

function basename(filePath) {
  const s = String(filePath || "letter.pdf").replace(/\\/g, "/");
  return s.split("/").pop() || "letter.pdf";
}

function pdfBody(file) {
  return file?.pdf || file?.buffer || file?.content || file?.bytes || null;
}

/**
 * Persist each PDF in a DIY pack. Cover .txt files are skipped.
 * One document row per file (discriminator = pack path) so a regen versions
 * that letter instead of collapsing the whole pack into one blob.
 */
export async function persistDiyPackageFiles(db, store, {
  orgId,
  clientId,
  files = [],
  generatedBy = "ds-02-diy-letters",
  sourceEventId = null
} = {}) {
  if (!db || !store || !orgId || !clientId) {
    return { stored: [], skipped: "missing_args" };
  }

  const stored = [];
  for (const file of files || []) {
    const body = pdfBody(file);
    if (!body) continue;
    const filePath = file.path || file.filename || file.name;
    if (!filePath) continue;
    const subtype = subtypeForPath(filePath);
    const discriminator = discriminatorFor(filePath);
    const { document } = await storeAndRegister(db, store, {
      orgId,
      clientId,
      kind: KINDS.DELIVERABLE,
      subtype,
      discriminator,
      title: `${titleFor(subtype)} — ${basename(filePath)}`,
      body,
      mimeType: "application/pdf",
      filename: basename(filePath),
      generatedBy,
      sourceEventId: sourceEventId ? `${sourceEventId}:${discriminator}` : null,
      metadata: { pack: "diy_escalation", path: discriminator }
    });
    stored.push({
      path: discriminator,
      subtype,
      documentId: document?.id || null,
      documentKey: document?.document_key || null
    });
  }
  return { stored, skipped: null };
}

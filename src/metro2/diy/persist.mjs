// Save DIY pack PDFs into the documents registry.
// COMPLIANCE REVIEW REQUIRED — dispute letters, CFPB/AG, furnisher validation.

import { KINDS, titleFor } from "../../documents/kinds.mjs";
import { storeAndRegister } from "../../documents/register.mjs";
import { LETTER_TYPES } from "../letters/catalog.mjs";

// ── TWO PACKS, TWO FILE SHAPES ─────────────────────────────────────────────
// This function was written for the DIY engine pack (src/metro2/diy/package.mjs),
// whose files are `{ path, pdf, text }` and carry no `type` on a bureau letter,
// so the filename was the only thing to classify on.
//
// The repair letter pack (src/underwrite/letter-pack.mjs, `pack: "repair"`) is
// the same kind of deliverable through a different builder, and its files are
// `{ filename, contentType, content, type }`. Two consequences, both handled
// below rather than by a second copy of this function:
//
//   * its files DO carry a `type`, which names the document better than any
//     filename match can — "State-Attorney-General-Complaint.pdf" does not
//     contain the string "state-ag-complaint" and would otherwise be filed as
//     a Metro 2 dispute letter.
//   * its cover sheets arrive as a Buffer in `content` with contentType
//     text/plain, so "has a body" is no longer enough to mean "is a PDF".
//
// An untyped file still falls through to the path classifier — that is the DIY
// engine pack's behaviour and it is unchanged.
const SUBTYPE_BY_TYPE = Object.freeze({
  [LETTER_TYPES.CFPB_COMPLAINT]: "cfpb_complaint",
  [LETTER_TYPES.STATE_AG_COMPLAINT]: "state_ag_complaint",
  [LETTER_TYPES.FURNISHER_VALIDATION]: "furnisher_validation",
  // The vendor letter generator labels every bureau round letter "dispute".
  dispute: "metro2_dispute_letter_pack",
  // The two repair-pack summaries keep their own document type as the subtype.
  // kinds.mjs leaves `subtype` unconstrained on purpose so a deliverable can
  // ship without a migration; filing these as a dispute letter would be a lie.
  repair_plan_summary: "repair_plan_summary",
  issue_priority_sheet: "issue_priority_sheet"
});

// titleFor() only knows the conventional subtypes. These two are not on that
// list, so they bring their own human title rather than registering as "Document".
const EXTRA_TITLES = Object.freeze({
  repair_plan_summary: "Optimization Plan Summary",
  issue_priority_sheet: "Issue Priority Sheet"
});

function subtypeForPath(filePath) {
  const s = String(filePath || "").toLowerCase();
  if (s.includes("cfpb-complaint")) return "cfpb_complaint";
  if (s.includes("state-ag-complaint")) return "state_ag_complaint";
  if (s.includes("furnisher-validation")) return "furnisher_validation";
  return "metro2_dispute_letter_pack";
}

function subtypeForFile(file, filePath) {
  const t = String(file?.type || file?.letterType || file?.docType || "").toLowerCase();
  return SUBTYPE_BY_TYPE[t] || subtypeForPath(filePath);
}

/**
 * Is this file actually a PDF? Everything registered here is stored as
 * application/pdf, so a text cover sheet must never reach the store.
 */
function isPdfFile(file, filePath) {
  const contentType = String(file?.contentType || file?.content_type || "").toLowerCase();
  if (contentType) return contentType.includes("pdf");
  if (file?.pdf) return true;
  return !String(filePath || "").toLowerCase().endsWith(".txt");
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
 * Persist each PDF in a letter pack. Cover .txt files are skipped.
 * One document row per file (discriminator = pack path) so a regen versions
 * that letter instead of collapsing the whole pack into one blob.
 *
 * Serves both the DIY engine pack and the repair letter pack — see the file
 * header for how the two file shapes differ and where that is absorbed.
 */
export async function persistDiyPackageFiles(db, store, {
  orgId,
  clientId,
  files = [],
  generatedBy = "ds-02-diy-letters",
  sourceEventId = null,
  pack = "diy_escalation"
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
    if (!isPdfFile(file, filePath)) continue;
    const subtype = subtypeForFile(file, filePath);
    const discriminator = discriminatorFor(filePath);
    const { document } = await storeAndRegister(db, store, {
      orgId,
      clientId,
      kind: KINDS.DELIVERABLE,
      subtype,
      discriminator,
      title: `${EXTRA_TITLES[subtype] || titleFor(subtype)} — ${basename(filePath)}`,
      body,
      mimeType: "application/pdf",
      filename: basename(filePath),
      generatedBy,
      sourceEventId: sourceEventId ? `${sourceEventId}:${discriminator}` : null,
      metadata: { pack, path: discriminator }
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

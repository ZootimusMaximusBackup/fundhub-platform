// Pure split of Claude deliverables into the funding pack vs the repair pack.
// No network. No vendor load.

export const FUNDING_DOC_TYPES = ["credit_analysis", "roadmap", "funding_snapshot", "lender_match"];
export const FUNDING_ANALYSIS_FILENAMES = {
  credit_analysis: "Credit-Analysis-Report.pdf",
  roadmap: "Credit-Optimization-Roadmap.pdf",
  funding_snapshot: "Funding-Snapshot.pdf",
  lender_match: "Bank-Lender-Match-List.pdf"
};
const FUNDING_LETTER_TYPES = new Set(["personal_info", "inquiry_removal"]);
const REPAIR_LETTER_TYPES = new Set(["dispute", "personal_info"]);

export function documentsFromDeliverables(documents = {}) {
  if (!documents || typeof documents !== "object" || Array.isArray(documents)) return [];
  return [
    { type: "credit_analysis", content: documents.creditAnalysis },
    { type: "roadmap", content: documents.roadmap },
    { type: "funding_snapshot", content: documents.fundingSnapshot },
    { type: "lender_match", content: documents.lenderMatchList }
  ].filter((d) => d.content);
}

export function filterPack(deliverables, pack) {
  const src = deliverables && typeof deliverables === "object" && !Array.isArray(deliverables)
    ? deliverables
    : {};
  const allDocs = documentsFromDeliverables(src.documents || {});
  const allLetters = Array.isArray(src.letters)
    ? src.letters.filter((l) => l && typeof l === "object")
    : [];
  if (pack === "repair") {
    return {
      documents: [],
      letters: allLetters.filter((l) => REPAIR_LETTER_TYPES.has(l.type))
    };
  }
  return {
    documents: allDocs.filter((d) => FUNDING_DOC_TYPES.includes(d.type)),
    letters: allLetters.filter((l) => FUNDING_LETTER_TYPES.has(l.type))
  };
}

/** True only when all four funding analysis PDFs are present (type or filename). */
export function hasFundingAnalysisPdfs(files = []) {
  const list = Array.isArray(files) ? files : [];
  const types = new Set();
  const names = new Set();
  for (const f of list) {
    if (!f || typeof f !== "object") continue;
    if (f.type) types.add(f.type);
    if (f.docType) types.add(f.docType);
    if (f.filename) names.add(String(f.filename));
  }
  return FUNDING_DOC_TYPES.every((t) => types.has(t) || names.has(FUNDING_ANALYSIS_FILENAMES[t]));
}

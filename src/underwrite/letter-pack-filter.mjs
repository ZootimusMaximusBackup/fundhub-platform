// Pure split of Claude deliverables into the funding pack vs the repair pack.
// No network. No vendor load.

export const FUNDING_DOC_TYPES = ["credit_analysis", "roadmap", "funding_snapshot", "lender_match"];
export const FUNDING_ANALYSIS_FILENAMES = {
  credit_analysis: "Credit-Analysis-Report.pdf",
  roadmap: "Credit-Optimization-Roadmap.pdf",
  funding_snapshot: "Funding-Snapshot.pdf",
  lender_match: "Bank-Lender-Match-List.pdf"
};
export const FUNDING_LETTER_TYPES = new Set(["personal_info", "inquiry_removal"]);
export const REPAIR_LETTER_TYPES = new Set(["dispute", "personal_info"]);

const BUREAU_PREFIX = Object.freeze({ EX: "ex", EQ: "eq", TU: "tu" });

/** Map EX/EQ/TU, experian/equifax/transunion, or ex/eq/tu → EX|EQ|TU. */
export function normBureauCode(bureau) {
  const raw = String(bureau || "").trim();
  if (!raw) return null;
  const u = raw.toUpperCase();
  if (u === "EX" || u === "EXPERIAN") return "EX";
  if (u === "EQ" || u === "EQUIFAX") return "EQ";
  if (u === "TU" || u === "TRANSUNION") return "TU";
  const l = raw.toLowerCase();
  if (l === "ex" || l === "experian") return "EX";
  if (l === "eq" || l === "equifax") return "EQ";
  if (l === "tu" || l === "transunion") return "TU";
  return null;
}

export function bureauFromFilename(filename) {
  const fn = String(filename || "").toLowerCase();
  const m = fn.match(/(?:^|[\\/_])(?:inquiry_|personal_info_|repair_)?(ex|eq|tu)(?:_round\\d+)?\\.pdf$/)
    || fn.match(/(?:^|[\\/_])(ex|eq|tu)_round\\d+\\.pdf$/);
  if (!m) return null;
  return normBureauCode(m[1]);
}

/** True for Metro 2 dispute / round letters — never mail these on funding path. */
export function isDisputeLetterFile(file) {
  if (!file || typeof file !== "object") return false;
  if (file.type === "dispute" || file.letterType === "dispute" || file.letter_type === "dispute") {
    return true;
  }
  const fn = String(file.filename || file.name || file.path || "").toLowerCase();
  return /(?:^|[\\/_])(ex|eq|tu)_round\\d+\\.pdf$/.test(fn) || /metro\s*2|dispute/.test(fn);
}

export function isFundingLetterFile(file) {
  if (!file || typeof file !== "object") return false;
  if (isDisputeLetterFile(file)) return false;
  if (FUNDING_LETTER_TYPES.has(file.type) || FUNDING_LETTER_TYPES.has(file.letterType) || FUNDING_LETTER_TYPES.has(file.letter_type)) {
    return true;
  }
  const fn = String(file.filename || file.name || file.path || "").toLowerCase();
  return /(?:^|[\\/_])(inquiry_|personal_info_)(ex|eq|tu)\\.pdf$/.test(fn);
}

function letterBureau(file) {
  return normBureauCode(file.bureau || file.bureauCode || file.bureau_code)
    || bureauFromFilename(file.filename || file.name || file.path);
}

function letterTypeOf(file) {
  if (FUNDING_LETTER_TYPES.has(file.type)) return file.type;
  if (FUNDING_LETTER_TYPES.has(file.letterType)) return file.letterType;
  if (FUNDING_LETTER_TYPES.has(file.letter_type)) return file.letter_type;
  const fn = String(file.filename || file.name || file.path || "").toLowerCase();
  if (/inquiry_/.test(fn)) return "inquiry_removal";
  if (/personal_info_/.test(fn)) return "personal_info";
  return null;
}

/**
 * Pick the funding-stack letter file for one bureau.
 * Prefers inquiry_removal, then personal_info. Never dispute / roundN.
 */
export function pickFundingLetterFile(files = [], bureau) {
  const code = normBureauCode(bureau);
  if (!code) return null;
  const list = Array.isArray(files) ? files : [];
  const matches = list.filter((f) => isFundingLetterFile(f) && letterBureau(f) === code);
  if (!matches.length) return null;
  const inquiry = matches.find((f) => letterTypeOf(f) === "inquiry_removal");
  if (inquiry) return inquiry;
  return matches.find((f) => letterTypeOf(f) === "personal_info") || matches[0];
}

export function pdfContentToBase64(content) {
  if (content == null) return null;
  if (typeof content === "string") {
    const s = content.trim();
    if (!s) return null;
    // Already base64 (PostGrid path) or raw — callers store base64 on case columns.
    return s;
  }
  if (Buffer.isBuffer(content)) return content.toString("base64");
  if (content instanceof Uint8Array) return Buffer.from(content).toString("base64");
  if (content?.type === "Buffer" && Array.isArray(content.data)) {
    return Buffer.from(content.data).toString("base64");
  }
  return null;
}

/** Base64 PDF for bureau from an in-memory pack, or null. */
export function pickFundingLetterPdfBase64(files, bureau) {
  const file = pickFundingLetterFile(files, bureau);
  if (!file) return null;
  return pdfContentToBase64(file.content || file.buffer || file.pdf || file.pdfBase64 || file.bytes);
}

export { BUREAU_PREFIX };

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

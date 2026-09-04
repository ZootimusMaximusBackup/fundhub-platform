// Turn a stored CRS pull into per-bureau engine violations for the DIY pack.
// Never invent Metro 2 fields. One bureau file → one engine run → that bureau's letters.

import { normalizeFromCrs } from "../normalize.mjs";
import { runReport } from "../checks/index.mjs";
import { packViolationsFromReport } from "./from-engine.mjs";

const BUREAU_CODES = ["TU", "EX", "EQ"];

export function reportAsOf(report) {
  const files = Array.isArray(report?.creditFiles) ? report.creditFiles : [];
  for (const f of files) {
    const d = f?.creditFileDetail?.creditFileInfileDate;
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  }
  const requested = report?.responseDetail?.dateRequested;
  if (typeof requested === "string" && /^\d{4}-\d{2}-\d{2}/.test(requested)) {
    return requested.slice(0, 10);
  }
  return null;
}

function isBureauReport(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && (Array.isArray(value.tradelines) || Array.isArray(value.creditFiles) || Array.isArray(value.inquiries));
}

/**
 * Split a stored CRS result into one report per bureau.
 * Exported because src/metro2/diy/derogatory.mjs needs exactly the same split
 * and a second copy of it would drift.
 *
 * @param {object} merged  crs_results.result (bureaus.TU|EX|EQ) or a single bureau body
 * @returns {Record<string, object>}
 */
export function bureauReportsFromMergedCrs(merged) {
  if (!merged || typeof merged !== "object") return {};

  const reports = {};
  if (merged.bureaus && typeof merged.bureaus === "object") {
    for (const code of BUREAU_CODES) {
      if (isBureauReport(merged.bureaus[code])) reports[code] = merged.bureaus[code];
    }
  } else if (isBureauReport(merged)) {
    const files = Array.isArray(merged.creditFiles) ? merged.creditFiles : [];
    const source = files[0]?.creditFileDetail?.sourceType || merged.tradelines?.[0]?.sourceType;
    const code = source === "TransUnion" || source === "TU" ? "TU"
      : source === "Experian" || source === "EX" ? "EX"
        : source === "Equifax" || source === "EQ" ? "EQ"
          : null;
    if (code) reports[code] = merged;
  }
  return reports;
}

/**
 * @param {object} merged  crs_results.result (bureaus.TU|EX|EQ) or a single bureau body
 * @returns {Record<string, object[]>}
 */
export function violationsByBureauFromMergedCrs(merged) {
  const reports = bureauReportsFromMergedCrs(merged);

  const out = {};
  for (const [code, report] of Object.entries(reports)) {
    const asOf = reportAsOf(report);
    const { tradelines, context } = normalizeFromCrs(report, { asOf });
    const result = runReport(tradelines, context);
    const list = packViolationsFromReport(result);
    if (list.length) out[code] = list;
  }
  return out;
}

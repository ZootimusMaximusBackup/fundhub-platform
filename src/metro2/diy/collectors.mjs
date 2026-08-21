// Collectors for FDCPA validation letters.
// Do not guess "Midland" from a name. CRS soft-pulls often cannot see
// Exhibit 1. Only emit a collector when the engine already said collection.

const COLLECTION_VALIDATION_RULES = new Set([
  "M2-019", // K1 missing on a collection
  "M2-022", // medical collection under $500
  "M2-023"  // medical collection reported too soon
]);

function last4(v) {
  return v?.account_last4 || v?.accountLast4 || v?.last4 || null;
}

function collectorName(v) {
  const name = v?.creditor || v?.subject || null;
  const s = name == null ? "" : String(name).trim();
  return s || null;
}

function isCollectorFinding(v) {
  if (!v?.ruleId) return false;
  if (v.collection === true) return true;
  return COLLECTION_VALIDATION_RULES.has(v.ruleId);
}

/**
 * Unique collectors from engine-backed violations.
 * Used when the caller did not pass a furnishers list.
 */
export function collectorsFromViolations(violationsByBureau = {}) {
  const seen = new Map();
  for (const [bureau, list] of Object.entries(violationsByBureau || {})) {
    for (const v of list || []) {
      if (!isCollectorFinding(v)) continue;
      const name = collectorName(v);
      if (!name) continue;
      const key = `${String(bureau).toUpperCase()}|${name.toUpperCase()}|${last4(v) || ""}`;
      const row = seen.get(key) || {
        name,
        account_last4: last4(v),
        bureau: String(bureau).toUpperCase(),
        violations: []
      };
      row.violations.push(v);
      seen.set(key, row);
    }
  }
  return [...seen.values()];
}

export { COLLECTION_VALIDATION_RULES, isCollectorFinding };

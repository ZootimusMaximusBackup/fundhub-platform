// Extract disputable items (hard inquiries + personal-info mismatches) from a
// client's latest CRS / tri-merge pull. Grouped by bureau EX | EQ | TU.
//
// Pure where possible. Never invents items — missing shapes yield empty lists.

import { parseBureaus } from "../lenders/match.mjs";

const BUREAU_KEYS = Object.freeze(["EX", "EQ", "TU"]);

function normBureau(raw) {
  const codes = parseBureaus(raw);
  return codes.find((c) => BUREAU_KEYS.includes(c)) || null;
}

function asDate(v) {
  if (v == null || v === "") return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function emptyBuckets() {
  return {
    EX: { inquiries: [], pii: [] },
    EQ: { inquiries: [], pii: [] },
    TU: { inquiries: [], pii: [] }
  };
}

function pushInquiry(buckets, bureau, name, date) {
  const b = normBureau(bureau);
  if (!b || !name) return;
  const inquiry_name = String(name).trim();
  if (!inquiry_name) return;
  const key = `${inquiry_name.toLowerCase()}|${date || ""}`;
  if (buckets[b].inquiries.some((i) => i._key === key)) return;
  buckets[b].inquiries.push({
    kind: "inquiry",
    bureau: b,
    inquiry_name,
    inquiry_date: date,
    _key: key
  });
}

function pushPii(buckets, bureau, category, value) {
  const b = normBureau(bureau);
  if (!b || !value) return;
  const v = String(value).trim();
  if (!v) return;
  const cat = String(category || "other").trim().toLowerCase();
  const key = `${cat}|${v.toLowerCase()}`;
  if (buckets[b].pii.some((i) => i._key === key)) return;
  buckets[b].pii.push({
    kind: "pii",
    bureau: b,
    category: cat,
    value: v,
    inquiry_name: `${cat}: ${v}`,
    inquiry_date: null,
    _key: key
  });
}

function collectInquiries(buckets, list) {
  for (const inq of Array.isArray(list) ? list : []) {
    if (!inq) continue;
    const name = inq.creditorName || inq.inquiry || inq.inquiry_name || inq.name || inq.furnisher;
    const bureau = inq.source || inq.bureau || inq.bureauCode;
    const date = asDate(inq.date || inq.inquiry_date || inq.inquiryDate);
    pushInquiry(buckets, bureau, name, date);
  }
}

function collectPiiList(buckets, bureau, category, list) {
  for (const item of Array.isArray(list) ? list : []) {
    if (item == null) continue;
    if (typeof item === "string") {
      pushPii(buckets, bureau, category, item);
      continue;
    }
    const value =
      item.value || item.name || item.address || item.employer || item.text || item.label;
    const b = item.bureau || item.source || bureau;
    pushPii(buckets, b, item.category || category, value);
  }
}

/**
 * Walk a crs_results.result jsonb and fill per-bureau buckets.
 * @param {object|null} result
 * @returns {{ EX: object, EQ: object, TU: object }}
 */
export function extractFromCrsResult(result) {
  const buckets = emptyBuckets();
  if (!result || typeof result !== "object") return buckets;

  const normalized = result.normalized || result;
  collectInquiries(buckets, normalized.inquiries);
  collectInquiries(buckets, result.inquiries);
  collectInquiries(buckets, result.newInquiries);

  // Personal-info mismatches — several shapes appear in vendor payloads.
  const piiRoot =
    normalized.personalInfo ||
    normalized.personal_info ||
    normalized.identifyingInformation ||
    result.personalInfo ||
    result.personal_info ||
    null;

  if (piiRoot && typeof piiRoot === "object") {
    for (const [bureauHint, block] of Object.entries(piiRoot)) {
      if (!block || typeof block !== "object") continue;
      const b = normBureau(bureauHint) || bureauHint;
      collectPiiList(buckets, b, "name", block.names || block.nameVariants || block.aka);
      collectPiiList(buckets, b, "former_address", block.addresses || block.formerAddresses || block.former_addresses);
      collectPiiList(buckets, b, "former_employer", block.employers || block.formerEmployers || block.former_employers);
    }
  }

  // Per-bureau blocks under result.bureaus / consumerSignals
  const bureauBlocks = result.bureaus || normalized.bureaus || {};
  for (const [key, block] of Object.entries(bureauBlocks)) {
    if (!block || typeof block !== "object") continue;
    collectPiiList(buckets, key, "name", block.names);
    collectPiiList(buckets, key, "former_address", block.addresses);
    collectPiiList(buckets, key, "former_employer", block.employers);
    collectInquiries(buckets, block.inquiries);
  }

  return buckets;
}

/**
 * Load latest pull + open inquiry_log rows; merge into per-bureau items.
 */
export async function loadDisputables(db, { orgId, clientId }) {
  const crs = await db.query(
    `SELECT id, result, created_at
       FROM crs_results
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId, clientId]
  );
  const buckets = extractFromCrsResult(crs.rows[0]?.result || null);

  const openLog = await db.query(
    `SELECT bureau, inquiry, inquiry_name, created_at
       FROM inquiry_log
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND is_open = true`,
    [orgId, clientId]
  );
  for (const row of openLog.rows) {
    pushInquiry(
      buckets,
      row.bureau,
      row.inquiry_name || row.inquiry,
      asDate(row.created_at)
    );
  }

  // Strip internal keys before return
  const out = {};
  for (const b of BUREAU_KEYS) {
    const inquiries = buckets[b].inquiries.map(({ _key, ...rest }) => rest);
    const pii = buckets[b].pii.map(({ _key, ...rest }) => rest);
    out[b] = {
      inquiries,
      pii,
      items: [...inquiries, ...pii],
      openCount: inquiries.length + pii.length
    };
  }
  return {
    crsResultId: crs.rows[0]?.id || null,
    bureaus: out,
    bureausWithItems: BUREAU_KEYS.filter((b) => out[b].openCount > 0)
  };
}

export { BUREAU_KEYS, normBureau };

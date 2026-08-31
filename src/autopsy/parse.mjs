// Decline Autopsy — the upload boundary. CSV and manual rows in, cleaned rows
// out, and a REFUSAL for anything that still looks like a person.
//
// COMPLIANCE REVIEW REQUIRED. Spec: docs/specs/W3-decline-autopsy.md §5.
//
// TWO LAYERS, IN THIS ORDER, AND THE ORDER MATTERS:
//   1. Column names that look like identity are DROPPED, and counted, so the
//      broker sees what was thrown away.
//   2. Any surviving CELL that looks like an SSN, an e-mail or a phone REFUSES
//      THE WHOLE UPLOAD. Nothing is written. The caller has not yet touched
//      storage when this returns, which is the point: we cannot mishandle data
//      we never took.
//
// Pure. No clock, no I/O, no database. The endpoint decides what to do with the
// verdict; this file only produces it.

import { splitCsvLine } from "../lenders/csv.mjs";
import { toCents } from "../commissions/money.mjs";
import {
  ACCEPTED_KEYS,
  DECLINE_REASONS,
  FICO_BAND_KEYS,
  MAX_ROWS,
  MAX_ROW_LABEL,
  fieldKeyFor,
  isRefusedHeader,
  scanCellForPii
} from "./fields.mjs";

/* Fields whose values are numbers by definition. The 9-digit SSN shape and the
   10-digit phone shape both collide with a large revenue figure, so these are
   exempted from the value scan and validated as numbers instead — a column that
   must parse as a number cannot smuggle an e-mail through. Every other field is
   scanned. */
const NUMERIC_FIELDS = new Set([
  "business_age_months",
  "annual_revenue_usd",
  "requested_amount_usd",
  "open_tradelines",
  "revolving_utilization_pct",
  "highest_revolving_limit_usd"
]);

const clean = (v, max = 200) => (v === null || v === undefined ? "" : String(v).trim().slice(0, max));

/** A whole number >= 0, or null. NULL MEANS UNKNOWN and it must survive — an
 *  unparseable count is not a zero count. */
function wholeOrNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/** A percent in PERCENT UNITS (30 means 30%), 0–100, or null. The engine's
 *  convention — see src/underwrite/engine.mjs note (4). */
function pctOrNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().replace(/[%\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

/** Whole dollars -> integer cents, or null. Uses money.mjs so the repo has one
 *  conversion. A negative or unparseable amount is unknown, not zero. */
function centsOrNull(value) {
  const dollars = wholeOrNull(value);
  if (dollars === null) return null;
  try {
    return toCents(dollars);
  } catch {
    return null;
  }
}

/**
 * MONTH AND YEAR ONLY. A full date plus a state plus an amount is a
 * re-identification handle, so the day is never accepted — anything that parses
 * is normalised to the first of its month. Spec §8.3.
 * Returns "YYYY-MM-01" or null.
 */
export function monthOnly(value) {
  const s = clean(value, 32);
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12 || y < 1900 || y > 2200) return null;
    return `${y}-${String(mo).padStart(2, "0")}-01`;
  }
  m = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) {
    const mo = Number(m[1]);
    const y = Number(m[2]);
    if (mo < 1 || mo > 12 || y < 1900 || y > 2200) return null;
    return `${y}-${String(mo).padStart(2, "0")}-01`;
  }
  return null;
}

const STATE_RE = /^[A-Za-z]{2}$/;

/** Bureau letters, loosely. Unknown text is dropped rather than invented —
 *  src/lenders/match.mjs's own rule is that an unknown restriction means
 *  "include", never a made-up one. */
export function normalizeBureaus(value) {
  const s = clean(value, 64).toUpperCase();
  if (!s) return null;
  const found = [];
  if (/\bEX\b|EXPERIAN/.test(s)) found.push("EX");
  if (/\bEQ\b|EQUIFAX/.test(s)) found.push("EQ");
  if (/\bTU\b|TRANSUNION|TRANS UNION/.test(s)) found.push("TU");
  return found.length ? found.join(", ") : null;
}

/**
 * normalizeAutopsyRow(raw, index) — one row, cleaned, or a refusal.
 *
 * @returns {{ok:true,row:object}|{ok:false,error:string,message:string,column?:string,row:number}}
 */
export function normalizeAutopsyRow(raw, index = 0) {
  const src = raw && typeof raw === "object" ? raw : {};
  const rowNumber = index + 1;

  /* VALUE REJECTION, before anything is normalised or kept. */
  for (const key of ACCEPTED_KEYS) {
    if (NUMERIC_FIELDS.has(key)) continue;
    const hit = scanCellForPii(src[key]);
    if (hit) {
      return {
        ok: false,
        error: "personal_details_found",
        column: key,
        row: rowNumber,
        message:
          `We found what looks like ${hit.label} in the "${key}" column, row ${rowNumber}. ` +
          "Take those out and upload again — we only need the numbers."
      };
    }
  }

  const rowLabel = clean(src.row_label, MAX_ROW_LABEL);
  if (!rowLabel) {
    return {
      ok: false,
      error: "row_label_required",
      row: rowNumber,
      message: `Row ${rowNumber} has no label. Give each row your own short reference so you can match our answer back to your list.`
    };
  }

  const band = clean(src.fico_band, 16);
  const ficoBand = FICO_BAND_KEYS.includes(band) ? band : "unknown";

  const state = clean(src.state, 4).toUpperCase();
  const reason = clean(src.decline_reason, 40).toLowerCase().replace(/[^a-z]+/g, "_");

  return {
    ok: true,
    row: {
      row_label: rowLabel,
      fico_band: ficoBand,
      state: STATE_RE.test(state) ? state : null,
      business_age_months: wholeOrNull(src.business_age_months),
      annual_revenue_cents: centsOrNull(src.annual_revenue_usd),
      requested_amount_cents: centsOrNull(src.requested_amount_usd),
      declined_by: clean(src.declined_by, 80) || null,
      decline_reason: DECLINE_REASONS.includes(reason) ? reason : (reason ? "other" : null),
      declined_on_month: monthOnly(src.declined_on),
      bureaus_pulled: normalizeBureaus(src.bureaus_pulled),
      open_tradelines: wholeOrNull(src.open_tradelines),
      revolving_utilization_pct: pctOrNull(src.revolving_utilization_pct),
      highest_revolving_limit_cents: centsOrNull(src.highest_revolving_limit_usd),
      revolving_opened_month: monthOnly(src.revolving_opened_month)
    }
  };
}

/**
 * parseAutopsyCsv(text) — headers mapped, refused columns dropped and counted,
 * rows normalised.
 *
 * Reuses splitCsvLine from src/lenders/csv.mjs. There is no second CSV splitter
 * in this repo and there must not be one.
 *
 * @returns {{ok:true, rows:object[], droppedColumns:string[], ignoredColumns:string[]}
 *          |{ok:false, error:string, message:string, ...}}
 */
export function parseAutopsyCsv(text, { maxRows = MAX_ROWS } = {}) {
  const raw = String(text ?? "").replace(/^﻿/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    return {
      ok: false,
      error: "empty_csv",
      message: "That file has a header row and nothing else. Add at least one declined deal and upload again."
    };
  }

  const headers = splitCsvLine(lines[0]).map((h) => clean(h, 80));
  const droppedColumns = [];
  const ignoredColumns = [];
  const map = []; // index -> field key | null

  for (const h of headers) {
    if (isRefusedHeader(h)) {
      droppedColumns.push(h);
      map.push(null);
      continue;
    }
    const key = fieldKeyFor(h);
    if (!key) {
      ignoredColumns.push(h);
      map.push(null);
      continue;
    }
    map.push(key);
  }

  const bodyLines = lines.slice(1);
  if (bodyLines.length > maxRows) {
    return {
      ok: false,
      error: "too_many_rows",
      message: `That file has ${bodyLines.length} rows. We take up to ${maxRows} at a time — send your most recent ${maxRows} and upload again.`
    };
  }

  const rows = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const cells = splitCsvLine(bodyLines[i]);
    const obj = {};
    for (let c = 0; c < map.length; c++) {
      const key = map[c];
      if (!key) continue;               // dropped or ignored — never read, never stored
      obj[key] = cells[c] ?? "";
    }
    const norm = normalizeAutopsyRow(obj, i);
    if (!norm.ok) return norm;
    rows.push(norm.row);
  }

  if (!rows.length) {
    return {
      ok: false,
      error: "empty_csv",
      message: "We could not read a single deal out of that file. Check the column names and upload again."
    };
  }

  return { ok: true, rows, droppedColumns, ignoredColumns };
}

/**
 * parseAutopsyRows({ csvText, rows }) — the one entry point both upload paths
 * use, so CSV and the manual grid can never drift into different rules.
 */
export function parseAutopsyRows({ csvText = null, rows = null, maxRows = MAX_ROWS } = {}) {
  if (typeof csvText === "string" && csvText.trim()) {
    return parseAutopsyCsv(csvText, { maxRows });
  }
  if (Array.isArray(rows)) {
    if (!rows.length) {
      return { ok: false, error: "no_rows", message: "Add at least one declined deal before sending it in." };
    }
    if (rows.length > maxRows) {
      return {
        ok: false,
        error: "too_many_rows",
        message: `You sent ${rows.length} rows. We take up to ${maxRows} at a time.`
      };
    }
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const norm = normalizeAutopsyRow(rows[i], i);
      if (!norm.ok) return norm;
      out.push(norm.row);
    }
    return { ok: true, rows: out, droppedColumns: [], ignoredColumns: [] };
  }
  return { ok: false, error: "no_rows", message: "Send either a CSV file or typed rows." };
}

export default { parseAutopsyCsv, parseAutopsyRows, normalizeAutopsyRow, monthOnly, normalizeBureaus };

// Streaming RFC 4180 CSV reader/writer. Dependency-free on purpose.
//
// Federal bulk files are too big to hold in memory — the PPP release is ~1.8GB
// of CSV across a dozen files — so everything here is incremental: bytes in as
// they arrive off the wire, one row object out at a time, constant memory
// regardless of file size.
//
// It handles what the real files actually contain: a UTF-8 BOM, CRLF, quoted
// fields with embedded commas and newlines, "" escapes, and ragged rows where
// an agency dropped or added a trailing column mid-file.

/**
 * Parse an async iterable of chunks (Buffer or string) into arrays of cells.
 *
 * The state machine only ever holds the current field plus the current row, so
 * memory stays flat whether the file is 10 rows or 10 million.
 */
export async function* parseCsv(chunks, { delimiter = "," } = {}) {
  const DELIM = delimiter;
  let field = "";
  let row = [];
  let inQuotes = false;
  let quoteJustClosed = false;   // saw a closing quote; a second " means a literal "
  let sawAnyChar = false;
  let atStart = true;            // for BOM stripping
  let lastWasCR = false;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => {
    endField();
    const out = row;
    row = [];
    return out;
  };

  for await (const chunk of chunks) {
    let text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (atStart) {
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      atStart = false;
    }

    for (let i = 0; i < text.length; i++) {
      const c = text[i];

      // A CRLF pair must not emit two row breaks.
      if (lastWasCR) {
        lastWasCR = false;
        if (c === "\n") continue;
      }

      if (inQuotes) {
        if (quoteJustClosed) {
          quoteJustClosed = false;
          if (c === '"') { field += '"'; sawAnyChar = true; continue; }
          // The quote really did close the field; fall through and reprocess c
          // as an unquoted character.
          inQuotes = false;
        } else if (c === '"') {
          quoteJustClosed = true;
          continue;
        } else {
          field += c;
          sawAnyChar = true;
          continue;
        }
      }

      if (c === '"' && field === "") { inQuotes = true; sawAnyChar = true; continue; }
      if (c === DELIM) { endField(); sawAnyChar = true; continue; }
      if (c === "\r") { lastWasCR = true; if (sawAnyChar) yield endRow(); sawAnyChar = false; continue; }
      if (c === "\n") { if (sawAnyChar) yield endRow(); sawAnyChar = false; continue; }

      field += c;
      sawAnyChar = true;
    }
  }

  // Trailing row with no newline terminator.
  if (quoteJustClosed) inQuotes = false;
  if (sawAnyChar || field !== "" || row.length) yield endRow();
}

/**
 * Normalize a header cell to a match token: uppercase, alphanumeric only.
 *
 * This is what lets one field map survive schema drift. SBA has shipped the
 * same column as "BorrowerName", "Borrower Name" and "BORROWER_NAME" across
 * releases; all three reduce to BORROWERNAME and hit the same alias.
 */
export function headerToken(h) {
  return String(h ?? "").normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
}

/**
 * Resolve a declarative field map against a real header row.
 *
 * spec: { fieldName: ["PreferredHeader", "AlternateHeader", ...] }
 * Returns { index: {fieldName: columnNumber}, missing: [fieldName, ...] }.
 *
 * Aliases are tried in order, so the preferred spelling wins when a file
 * happens to carry both (SBA files sometimes carry a legacy duplicate column).
 */
export function resolveFields(header, spec) {
  const byToken = new Map();
  header.forEach((h, i) => {
    const t = headerToken(h);
    if (t && !byToken.has(t)) byToken.set(t, i);
  });

  const index = {};
  const missing = [];
  for (const [field, aliases] of Object.entries(spec)) {
    let found = -1;
    for (const alias of aliases) {
      const hit = byToken.get(headerToken(alias));
      if (hit !== undefined) { found = hit; break; }
    }
    if (found === -1) missing.push(field);
    else index[field] = found;
  }
  return { index, missing };
}

/** Read a mapped cell out of a row, tolerating short rows. */
export function cell(row, index, field) {
  const i = index[field];
  if (i === undefined) return null;
  const v = row[i];
  return v === undefined ? null : v;
}

/**
 * Stream a CSV as mapped records.
 *
 * Yields { values, raw, rowNumber } where `values` is the spec-mapped object.
 * `raw` is only materialized when keepRaw is set — at 8.5M rows, building a
 * full object per row purely for provenance is a measurable cost.
 */
export async function* readMapped(chunks, spec, { keepRaw = false, delimiter = "," } = {}) {
  let header = null;
  let index = null;
  let missing = [];
  let rowNumber = 0;

  for await (const row of parseCsv(chunks, { delimiter })) {
    if (!header) {
      header = row;
      ({ index, missing } = resolveFields(header, spec));
      continue;
    }
    // Skip blank lines the agency left between sections.
    if (row.length === 1 && row[0].trim() === "") continue;
    rowNumber += 1;

    const values = {};
    for (const field of Object.keys(index)) values[field] = cell(row, index, field);

    let raw = null;
    if (keepRaw) {
      raw = {};
      for (let i = 0; i < header.length; i++) {
        const v = row[i];
        if (v !== undefined && v !== "") raw[header[i]] = v;
      }
    }

    yield { values, raw, rowNumber, header, missing };
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Quote a value for CSV output.
 *
 * Also neutralizes the spreadsheet formula-injection vector: a cell beginning
 * =, +, -, @, tab or CR is executed as a formula when the export is opened in
 * Excel or Sheets. These exports are built from federal free-text fields and
 * handed to a mail house, so a business that named itself
 * `=HYPERLINK(...)` must not become live content in someone's spreadsheet.
 */
export function csvEscape(value) {
  if (value === null || value === undefined) return "";
  let s = Array.isArray(value) ? value.join(";") : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build one CRLF-terminated CSV line. */
export function csvLine(values) {
  return values.map(csvEscape).join(",") + "\r\n";
}

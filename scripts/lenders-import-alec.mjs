#!/usr/bin/env node
/**
 * Load the bank book into the CRM `lenders` table.
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR, in plain words.
 *
 * The funding advisor's bank list lives in a spreadsheet. This copies that
 * spreadsheet into the database the screens read. It matches a row in the file
 * to a row in the database by the bank's id from the original book
 * (`external_row_id`), updates the ones that match, and adds the ones that do
 * not. It never deletes a bank.
 *
 * ---------------------------------------------------------------------------
 * WHY IT ASKS BEFORE IT WRITES.
 *
 * The loader hands the WHOLE row from the file to the database, and an empty
 * cell in the file counts as an instruction to clear that field. So loading a
 * cut-down sheet — "just the bureaus", say — would erase every other column on
 * every row it touched. Nobody would see it happen; the screens would simply
 * go blank.
 *
 * Three guards stop that:
 *
 *   1. A DRY RUN IS THE DEFAULT. Nothing is written without --confirm.
 *   2. A PARTIAL SHEET IS REFUSED. The file has to carry every column the
 *      database knows about. (`logo_path` is the one exception — this script
 *      works that column out itself from the logo files on disk.)
 *   3. IT SHOWS WHAT WOULD BE ERASED. It reads what the database holds today,
 *      compares it cell by cell against the file, and lists every value the
 *      file would blank out. It refuses to do it unless you say so on purpose
 *      with --allow-clearing.
 *
 * ---------------------------------------------------------------------------
 * HOW TO RUN IT.
 *
 *   node --env-file=.env scripts/lenders-import-alec.mjs
 *       Dry run. Reads the database, writes nothing, prints exactly what it
 *       would change.
 *
 *   node --env-file=.env scripts/lenders-import-alec.mjs --confirm
 *       Does it.
 *
 *   --file <path>        use a specific spreadsheet instead of the default
 *   --org <slug>         a different company (default: DEFAULT_ORG_SLUG)
 *   --allow-clearing     let the file blank out values the database holds
 *
 * Does not invent banks. Skips tip/junk rows. Does not commit secrets.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, close } from "../src/db.mjs";
import { parseLenderCsv, serializeLenderCsv, splitCsvLine } from "../src/lenders/csv.mjs";
import { importLendersCsv } from "../src/lenders/store.mjs";
import { LENDER_CSV_COLUMNS } from "../src/lenders/tables.mjs";
import { isTipRow } from "../src/lenders/tips.mjs";
import { resolveLogoPath } from "../src/lenders/resolve-logo.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Newest book first. The bureau/ranking pass writes the "-with-bureaus" copy
   and leaves the original alone, so preferring it here is what makes the
   bureau work actually reach the screens. */
const CSV_CANDIDATES = [
  "credentials/lenders-audit/lenders-audited-with-bureaus.csv",
  "credentials/lenders-audit/lenders-audited.csv",
  "credentials/notion-scrape/output/lenders-legacy-strong.csv"
].map((p) => path.join(ROOT, p));

const LOGO_MAP = path.join(ROOT, "credentials/lenders-audit/logo-path-by-external-id.json");

/* This script fills logo_path itself from the logo files on disk, so the
   spreadsheet is not required to carry that column. Every other column must
   be there — see guard 2 above. */
const COLUMNS_THIS_SCRIPT_FILLS = new Set(["logo_path"]);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}
const CONFIRM = process.argv.includes("--confirm");
const ALLOW_CLEARING = process.argv.includes("--allow-clearing");
const SLUG = arg("--org") || process.env.DEFAULT_ORG_SLUG || "fundhub";

function publicExists(relPath) {
  const rel = String(relPath || "").replace(/^\//, "");
  return fs.existsSync(path.join(ROOT, "public", rel));
}

function pickCsvPath() {
  const asked = arg("--file");
  if (asked) {
    const abs = path.isAbsolute(asked) ? asked : path.join(ROOT, asked);
    if (!fs.existsSync(abs)) {
      console.error("That file is not there:", abs);
      process.exit(1);
    }
    return abs;
  }
  const found = CSV_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) {
    console.error("No bank book found. Looked at:");
    for (const p of CSV_CANDIDATES) console.error(" ", p);
    process.exit(1);
  }
  return found;
}

/** GUARD 2 — a partial sheet would wipe every column it leaves out. */
function checkColumns(text) {
  const firstLine = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/)[0] || "";
  const headers = splitCsvLine(firstLine).map((h) => h.trim()).filter(Boolean);
  const known = new Set(LENDER_CSV_COLUMNS);
  const missing = LENDER_CSV_COLUMNS.filter(
    (c) => !headers.includes(c) && !COLUMNS_THIS_SCRIPT_FILLS.has(c)
  );
  const filledHere = LENDER_CSV_COLUMNS.filter(
    (c) => !headers.includes(c) && COLUMNS_THIS_SCRIPT_FILLS.has(c)
  );
  return {
    headers,
    missing,
    filled_by_this_script: filledHere,
    unknown: headers.filter((h) => !known.has(h))
  };
}

/**
 * GUARD 3 — exactly which values the file would blank out.
 * Reads what the database holds, matches on external_row_id, and reports
 * every cell that holds something today and is empty in the file.
 */
async function wouldClear(orgId, banks) {
  const ids = banks.map((b) => b.external_row_id).filter(Boolean);
  if (!ids.length) return { rows: [], byColumn: {}, total: 0 };
  const cols = LENDER_CSV_COLUMNS.filter((c) => c !== "lender_table" && c !== "name");
  const existing = await db.query(
    `SELECT external_row_id, name, ${cols.join(", ")}
       FROM lenders
      WHERE org_id = $1::uuid AND external_row_id = ANY($2::text[])`,
    [orgId, ids]
  );
  const byId = new Map(existing.rows.map((r) => [r.external_row_id, r]));
  const byColumn = {};
  const rows = [];
  let total = 0;
  for (const bank of banks) {
    const current = bank.external_row_id ? byId.get(bank.external_row_id) : null;
    if (!current) continue;
    const losing = [];
    for (const col of cols) {
      const has = current[col] != null && String(current[col]).trim() !== "";
      // A column absent from the file is never sent, so it is never cleared.
      const inFile = Object.prototype.hasOwnProperty.call(bank, col);
      const blankInFile = bank[col] == null || String(bank[col]).trim() === "";
      if (has && inFile && blankInFile) {
        losing.push(col);
        byColumn[col] = (byColumn[col] || 0) + 1;
        total++;
      }
    }
    if (losing.length) rows.push({ name: bank.name, columns: losing });
  }
  return { rows, byColumn, total };
}

function countFilled(banks, col) {
  return banks.filter((b) => b[col] != null && String(b[col]).trim() !== "").length;
}

async function main() {
  const csvPath = pickCsvPath();
  const text = fs.readFileSync(csvPath, "utf8");

  const columns = checkColumns(text);
  const { rows, errors: parseErrors } = parseLenderCsv(text);

  const sidecar = fs.existsSync(LOGO_MAP)
    ? JSON.parse(fs.readFileSync(LOGO_MAP, "utf8"))
    : {};

  const banks = [];
  let tips = 0;
  let withLogo = 0;
  for (const row of rows) {
    if (isTipRow(row.name)) {
      tips++;
      continue;
    }
    const logo_path = resolveLogoPath({
      name: row.name,
      externalRowId: row.external_row_id,
      sidecar,
      exists: publicExists
    });
    if (logo_path) {
      row.logo_path = logo_path;
      withLogo++;
    }
    banks.push(row);
  }

  console.log("File            :", path.relative(ROOT, csvPath));
  console.log("Company         :", SLUG);
  console.log("Rows in the file:", rows.length, "—", banks.length, "banks,", tips, "tip rows skipped");
  console.log("");

  if (columns.unknown.length) {
    console.log("Columns the database does not know, ignored:", columns.unknown.join(", "));
  }
  if (columns.filled_by_this_script.length) {
    console.log(
      "Columns this script fills itself:",
      columns.filled_by_this_script.join(", "),
      `(${withLogo} of ${banks.length} banks have a logo file on disk)`
    );
  }
  if (columns.missing.length) {
    console.error("");
    console.error("STOPPED. This is a partial sheet and loading it would erase data.");
    console.error("");
    console.error("The loader treats an empty cell as an instruction to clear that field, and");
    console.error("a column that is not in the file at all cannot be checked. These columns are");
    console.error("missing from the file:");
    console.error("");
    for (const c of columns.missing) console.error("  " + c);
    console.error("");
    console.error("Use the whole book — all " + LENDER_CSV_COLUMNS.length + " columns.");
    process.exitCode = 1;
    return;
  }
  if (parseErrors.length) {
    console.log("Rows the file could not use:", parseErrors.length);
    for (const e of parseErrors.slice(0, 10)) console.log("  " + e);
    if (parseErrors.length > 10) console.log("  ...and " + (parseErrors.length - 10) + " more");
    console.log("");
  }

  const org = await db.query(`SELECT id FROM orgs WHERE slug = $1 LIMIT 1`, [SLUG]);
  const orgId = org.rows[0]?.id;
  if (!orgId) {
    console.error("No company with the short name", SLUG);
    process.exitCode = 1;
    return;
  }

  const beforeQ = await db.query(
    `SELECT count(*)::int AS banks,
            count(logo_path)::int AS with_logo,
            count(nullif(btrim(coalesce(bureaus_pulled, '')), ''))::int AS with_bureau,
            count(priority_tier)::int AS with_ranking
       FROM lenders WHERE org_id = $1::uuid`,
    [orgId]
  );
  const before = beforeQ.rows[0];

  const clearing = await wouldClear(orgId, banks);

  console.log("In the database now :", before.banks, "banks,",
    before.with_bureau, "with a bureau,", before.with_ranking, "with a ranking,",
    before.with_logo, "with a logo");
  console.log("The file carries    :", banks.length, "banks,",
    countFilled(banks, "bureaus_pulled"), "with a bureau,",
    countFilled(banks, "priority_tier"), "with a ranking,",
    withLogo, "with a logo");
  console.log("");

  if (clearing.total) {
    console.log("VALUES THE FILE WOULD BLANK OUT:", clearing.total,
      "across", clearing.rows.length, "banks");
    for (const [col, n] of Object.entries(clearing.byColumn).sort((a, b) => b[1] - a[1])) {
      console.log("  " + col + ": " + n);
    }
    console.log("");
    for (const r of clearing.rows.slice(0, 20)) {
      console.log("  " + r.name + " — " + r.columns.join(", "));
    }
    if (clearing.rows.length > 20) {
      console.log("  ...and " + (clearing.rows.length - 20) + " more banks");
    }
    console.log("");
    if (!ALLOW_CLEARING) {
      console.error("STOPPED. The file is older than the database on those cells.");
      console.error("Someone edited those banks in the CRM after this file was made.");
      console.error("");
      console.error("Either put the newer values into the file, or run again with");
      console.error("--allow-clearing if losing them is what you want.");
      process.exitCode = 1;
      return;
    }
    console.log("--allow-clearing was given. Those values will be lost.");
    console.log("");
  } else {
    console.log("Nothing would be blanked out. Every value the database holds is either");
    console.log("in the file too, or in a column the file does not touch.");
    console.log("");
  }

  if (!CONFIRM) {
    console.log("DRY RUN. Nothing was written. Add --confirm to load it.");
    return;
  }

  const result = await importLendersCsv(db, {
    orgId,
    text: serializeLenderCsv(banks),
    staff: { name: "alec-legacy-strong-import" }
  });

  const afterQ = await db.query(
    `SELECT count(*)::int AS banks,
            count(logo_path)::int AS with_logo,
            count(nullif(btrim(coalesce(bureaus_pulled, '')), ''))::int AS with_bureau,
            count(priority_tier)::int AS with_ranking
       FROM lenders WHERE org_id = $1::uuid`,
    [orgId]
  );

  console.log(JSON.stringify({
    source: path.relative(ROOT, csvPath),
    banks_count: banks.length,
    unique_names: new Set(banks.map((b) => b.name)).size,
    banks_with_logo_in_file: withLogo,
    missing_logo_names: banks.filter((b) => !b.logo_path).map((b) => b.name),
    parse_errors: parseErrors,
    before,
    import: result,
    after: afterQ.rows[0],
    page: "/app/lenders.html"
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(() => close());

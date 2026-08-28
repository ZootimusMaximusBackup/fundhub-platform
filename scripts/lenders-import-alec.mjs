#!/usr/bin/env node
/**
 * Load Alec / Legacy Strong lender CSV into the CRM lenders table.
 *
 * Reads:
 *   credentials/notion-scrape/output/lenders-legacy-strong.csv
 *   credentials/lenders-audit/lenders-audited.csv (preferred when present)
 *   credentials/lenders-audit/logo-path-by-external-id.json
 *   public/assets/lenders/*.png
 *
 * Does not invent banks. Skips tip/junk rows. Does not commit secrets.
 *
 * Usage: node --env-file=.env scripts/lenders-import-alec.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, close } from "../src/db.mjs";
import { parseLenderCsv, serializeLenderCsv } from "../src/lenders/csv.mjs";
import { importLendersCsv } from "../src/lenders/store.mjs";
import { isTipRow } from "../src/lenders/tips.mjs";
import { resolveLogoPath } from "../src/lenders/resolve-logo.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV_AUDITED = path.join(ROOT, "credentials/lenders-audit/lenders-audited.csv");
const CSV_SOURCE = path.join(ROOT, "credentials/notion-scrape/output/lenders-legacy-strong.csv");
const LOGO_MAP = path.join(ROOT, "credentials/lenders-audit/logo-path-by-external-id.json");
const SLUG = process.env.DEFAULT_ORG_SLUG || "fundhub";

function publicExists(relPath) {
  const rel = String(relPath || "").replace(/^\//, "");
  return fs.existsSync(path.join(ROOT, "public", rel));
}

async function main() {
  const csvPath = fs.existsSync(CSV_AUDITED) ? CSV_AUDITED : CSV_SOURCE;
  if (!fs.existsSync(csvPath)) {
    console.error("Alec lender list missing. Looked at:");
    console.error(" ", CSV_AUDITED);
    console.error(" ", CSV_SOURCE);
    process.exit(1);
  }

  const sidecar = fs.existsSync(LOGO_MAP)
    ? JSON.parse(fs.readFileSync(LOGO_MAP, "utf8"))
    : {};

  const { rows, errors: parseErrors } = parseLenderCsv(fs.readFileSync(csvPath, "utf8"));
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

  const org = await db.query(`SELECT id FROM orgs WHERE slug = $1 LIMIT 1`, [SLUG]);
  const orgId = org.rows[0]?.id;
  if (!orgId) {
    console.error("No org with slug", SLUG);
    process.exit(1);
  }

  const before = await db.query(
    `SELECT count(*)::int AS n, count(logo_path)::int AS logos
       FROM lenders WHERE org_id = $1::uuid`,
    [orgId]
  );

  const result = await importLendersCsv(db, {
    orgId,
    text: serializeLenderCsv(banks),
    staff: { name: "alec-legacy-strong-import" }
  });

  const after = await db.query(
    `SELECT count(*)::int AS n, count(logo_path)::int AS logos
       FROM lenders WHERE org_id = $1::uuid`,
    [orgId]
  );

  console.log(JSON.stringify({
    source: path.relative(ROOT, csvPath),
    parsed_rows: rows.length,
    tip_rows_skipped: tips,
    banks_count: banks.length,
    unique_names: new Set(banks.map((b) => b.name)).size,
    banks_with_logo_in_file: withLogo,
    missing_logo_names: banks.filter((b) => !b.logo_path).map((b) => b.name),
    parse_errors: parseErrors,
    before: before.rows[0],
    import: result,
    after: after.rows[0],
    page: "/app/lenders.html"
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(() => close());

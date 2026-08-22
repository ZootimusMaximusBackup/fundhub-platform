#!/usr/bin/env node
/**
 * Apply audit manifest to lender CSV (URLs only — logos stay as assets + logo_path sidecar).
 *
 * Writes:
 *   credentials/lenders-audit/lenders-audited.csv
 *   credentials/lenders-audit/logo-path-by-external-id.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLenderCsv, serializeLenderCsv } from "../../src/lenders/csv.mjs";
import { slugFromName, normalizeName, isTipRow } from "./normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CSV_IN = path.join(ROOT, "credentials/notion-scrape/output/lenders-legacy-strong.csv");
const MANIFEST = path.join(ROOT, "credentials/lenders-audit/manifest.json");
const CSV_OUT = path.join(ROOT, "credentials/lenders-audit/lenders-audited.csv");
const LOGO_MAP = path.join(ROOT, "credentials/lenders-audit/logo-path-by-external-id.json");

function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error("Run lenders:audit first — missing", MANIFEST);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  /** @type {Map<string, { application_url?: string, logo_path?: string }>} */
  const bySlug = new Map();
  for (const e of manifest.entries) {
    bySlug.set(e.slug, {
      application_url: e.application_url || undefined,
      logo_path: e.logo_path || undefined
    });
  }

  const { rows } = parseLenderCsv(fs.readFileSync(CSV_IN, "utf8"));
  const logoByExternal = {};

  for (const row of rows) {
    if (isTipRow(row.name)) continue;
    const slug = slugFromName(normalizeName(row.name));
    const hit = bySlug.get(slug);
    if (!hit) continue;
    if (hit.application_url) row.application_url = hit.application_url;
    if (hit.logo_path && row.external_row_id) {
      logoByExternal[row.external_row_id] = hit.logo_path;
    }
  }

  fs.mkdirSync(path.dirname(CSV_OUT), { recursive: true });
  fs.writeFileSync(CSV_OUT, serializeLenderCsv(rows));
  fs.writeFileSync(LOGO_MAP, JSON.stringify(logoByExternal, null, 2));
  console.log("Wrote", CSV_OUT);
  console.log("Wrote", LOGO_MAP, `(${Object.keys(logoByExternal).length} logo paths)`);
}

main();

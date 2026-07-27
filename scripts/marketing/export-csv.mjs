#!/usr/bin/env node
// Export the warehouse as a CSV a mail house or dialer can consume.
//
//   node scripts/marketing/export-csv.mjs [filters] --out list.csv
//
// Default columns are the ones a campaign needs:
//   name, address_line1, city, state, zip5, phone, email, source_tags, loan_amount
//
// Filters
//   --source TAGS     comma list; record must carry ANY of them (ppp,fmcsa,…)
//   --all-sources T   comma list; record must carry ALL of them
//   --state XX        comma list of state codes
//   --naics PREFIX    comma list of NAICS prefixes ("484" = trucking)
//   --min-loan N      minimum observed loan amount
//   --max-loan N
//   --min-fleet N     minimum FMCSA power units
//   --has-phone       phone or cell present
//   --has-email
//   --has-address     mailable (default ON; use --no-address-filter to include all)
//   --multi-source    only records confirmed by 2+ federal sources
//   --limit N
//   --columns a,b,c   override the column set
//   --out PATH        write to a file (default stdout)
//
// Examples
//   # callable trucking prospects with 5+ trucks
//   node scripts/marketing/export-csv.mjs --source fmcsa --has-phone --min-fleet 5 --out carriers.csv
//
//   # PPP borrowers in Texas we can also phone, i.e. the cross-source win
//   node scripts/marketing/export-csv.mjs --all-sources ppp,fmcsa --state TX --has-phone --out tx.csv
//
// Streams with keyset pagination, so exporting millions of rows uses flat
// memory and never holds the full result set.

import fs from "node:fs";
import { pool, close } from "../../src/db.mjs";
import { csvLine } from "./lib/csv.mjs";
import { resolveOrgId } from "./lib/warehouse.mjs";

const DEFAULT_COLUMNS = [
  "name", "address_line1", "city", "state", "zip5",
  "phone", "email", "source_tags", "loan_amount",
];

const AVAILABLE = new Set([
  "id", "name", "dba_name", "address_line1", "city", "state", "zip5",
  "phone", "phone_cell", "email", "naics", "fleet_size",
  "loan_amount", "loan_total", "loan_count", "source_tags", "first_seen_at",
  "has_address", "has_phone", "has_email", "multi_source",
]);

function parseArgs(argv) {
  const args = { _: [] };
  const flags = [
    "has-phone", "has-email", "has-address", "no-address-filter",
    "multi-source", "help",
  ];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { args._.push(a); continue; }
    const key = a.slice(2);
    if (flags.includes(key)) { args[key] = true; continue; }
    args[key] = argv[++i];
  }
  return args;
}

const list = (v) => (v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : null);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.error("see the header of scripts/marketing/export-csv.mjs");
    return;
  }

  const columns = list(args.columns) || DEFAULT_COLUMNS;
  const bad = columns.filter((c) => !AVAILABLE.has(c));
  if (bad.length) throw new Error(`unknown column(s): ${bad.join(", ")}\navailable: ${[...AVAILABLE].join(", ")}`);

  const db = pool();
  const orgId = await resolveOrgId(db, args.org);

  // ── build the predicate ────────────────────────────────────────────────────
  const where = ["org_id = $1"];
  const params = [orgId];
  const add = (sql, value) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)); };

  if (args.source) add("source_tags && ?::text[]", list(args.source));
  if (args["all-sources"]) add("source_tags @> ?::text[]", list(args["all-sources"]));
  if (args.state) add("state = ANY(?::text[])", list(args.state).map((s) => s.toUpperCase()));
  if (args.naics) {
    // Prefix match on NAICS: "484" selects all of truck transportation.
    const prefixes = list(args.naics);
    params.push(prefixes);
    where.push(`EXISTS (SELECT 1 FROM unnest($${params.length}::text[]) p WHERE naics LIKE p || '%')`);
  }
  if (args["min-loan"]) add("loan_amount >= ?::numeric", args["min-loan"]);
  if (args["max-loan"]) add("loan_amount <= ?::numeric", args["max-loan"]);
  if (args["min-fleet"]) add("fleet_size >= ?::integer", args["min-fleet"]);
  if (args["has-phone"]) where.push("has_phone");
  if (args["has-email"]) where.push("has_email");
  if (args["multi-source"]) where.push("multi_source");
  // Mailability is the default because an unmailable record is not a lead.
  if (!args["no-address-filter"]) where.push("has_address");

  const limit = args.limit ? Number(args.limit) : Infinity;
  const out = args.out ? fs.createWriteStream(args.out) : process.stdout;

  const write = (chunk) =>
    out.write(chunk) ? Promise.resolve() : new Promise((r) => out.once("drain", r));

  await write(csvLine(columns));

  // ── stream by keyset ───────────────────────────────────────────────────────
  const PAGE = 5000;
  let after = "00000000-0000-0000-0000-000000000000";
  let written = 0;

  const sql = `
    SELECT id, ${columns.filter((c) => c !== "id").join(", ")}
      FROM marketing.mailable_businesses
     WHERE ${where.join(" AND ")}
       AND id > $${params.length + 1}
     ORDER BY id
     LIMIT $${params.length + 2}`;

  while (written < limit) {
    const pageSize = Math.min(PAGE, limit - written);
    const { rows } = await db.query(sql, [...params, after, pageSize]);
    if (!rows.length) break;

    for (const row of rows) {
      await write(csvLine(columns.map((c) => row[c])));
      written += 1;
    }
    after = rows[rows.length - 1].id;
    if (rows.length < pageSize) break;
  }

  if (args.out) {
    await new Promise((resolve, reject) => out.end(resolve).on("error", reject));
    console.error(`✔ wrote ${written.toLocaleString("en-US")} rows to ${args.out}`);
    console.error(`  columns: ${columns.join(", ")}`);
  } else {
    console.error(`✔ ${written.toLocaleString("en-US")} rows`);
  }

  await close();
}

main().catch(async (err) => {
  console.error(`FATAL: ${err?.stack || err?.message || err}`);
  await close().catch(() => {});
  process.exit(1);
});

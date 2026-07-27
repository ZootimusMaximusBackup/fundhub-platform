#!/usr/bin/env node
// Generate 10,000-row SAMPLE files for each Phase 1 source.
//
//   node scripts/marketing/make-sample.mjs [--rows 10000] [--out DIR]
//
// ⚠️ THE OUTPUT IS SYNTHETIC. These are NOT federal records and must never be
//    mailed, dialed, emailed, or presented as real business data. Every row is
//    generated from a seeded PRNG. The files exist so the pipeline can be
//    proven end to end — parse, normalize, dedupe, upsert, re-run, export —
//    without pulling gigabytes from a government server on every test run.
//
//    Real data comes from `ingest.mjs <source>`, which downloads the actual
//    published files. See README.md.
//
// What makes these fixtures useful rather than decorative:
//
//   • The HEADERS are the real published schemas, column-for-column, so the
//     alias-based field maps in lib/sources.mjs are genuinely exercised.
//   • The same business appears ACROSS sources under different spellings
//     ("Rivera Hauling LLC" in PPP, "RIVERA HAULING, L.L.C." in FMCSA, at
//     "1420 N. Industrial Blvd. Ste 4" vs "1420 North Industrial Boulevard,
//     Suite 4"). That is the exact case the warehouse is built to collapse.
//   • The same business appears TWICE WITHIN a file (a second PPP draw, a
//     re-filed MCS-150), which exercises in-batch merging.
//   • Dirty rows are included on purpose: redacted "N/A" names, missing
//     addresses, 555 placeholder phones, "UNKNOWN" emails, names containing
//     commas, quotes and embedded newlines.
//
// Deterministic: same seed in, byte-identical files out.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { csvLine } from "./lib/csv.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── seeded PRNG (mulberry32) ────────────────────────────────────────────────
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Rivera", "Nguyen", "Okafor", "Delgado", "Kowalski", "Bergstrom", "Haddad",
  "Whitfield", "Castellano", "Abernathy", "Fontaine", "Yamamoto", "Brennan", "Sokolov",
  "Marchetti", "Adeyemi", "Lindqvist", "Vargas", "Thibodeaux", "Ellsworth"];
const TRADE = ["Hauling", "Logistics", "Freight", "Transport", "Trucking", "Carriers",
  "Distribution", "Cartage", "Express", "Dispatch", "Motorlines", "Delivery"];
const OTHER = ["Dental", "Roofing", "Landscaping", "Catering", "Plumbing", "Auto Body",
  "Staffing", "Consulting", "Bakery", "Fitness", "Printing", "Welding"];
const SUFFIX = ["LLC", "Inc", "Corp", "Co", "LLC", "Inc", "Ltd", "LLC"];

const STREETS = ["Industrial Blvd", "Main St", "Commerce Dr", "Airport Rd", "Frontage Rd",
  "Old Mill Rd", "Enterprise Way", "Baker St", "Cypress Ave", "Ridgeline Pkwy"];
const DIRS = ["", "N ", "S ", "E ", "W ", "NW ", "SE "];

const CITIES = [
  ["Laredo", "TX", "78045"], ["Fresno", "CA", "93725"], ["Joliet", "IL", "60432"],
  ["Macon", "GA", "31206"], ["Akron", "OH", "44312"], ["Boise", "ID", "83709"],
  ["Mobile", "AL", "36608"], ["Reno", "NV", "89502"], ["Tulsa", "OK", "74107"],
  ["Scranton", "PA", "18505"], ["Springfield", "MO", "65803"], ["Salem", "OR", "97305"],
];
const LENDERS = ["Cross River Bank", "Customers Bank", "Harvest Small Business Finance",
  "Celtic Bank Corporation", "Prestamos CDFI LLC", "Zions Bank", "Live Oak Banking Company",
  "Newtek Small Business Finance", "Byline Bank", "Readycap Lending LLC"];
const NAICS_TRUCK = ["484121", "484110", "484122", "492110"];
const NAICS_OTHER = ["621210", "238160", "561730", "722320", "238220", "811121",
  "561320", "541611", "311811", "713940", "323111", "332313"];

/** Build the shared universe of businesses every source draws from. */
function buildUniverse(count, rand) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const isTruck = rand() < 0.45;
    const base = `${FIRST[Math.floor(rand() * FIRST.length)]} ${
      (isTruck ? TRADE : OTHER)[Math.floor(rand() * (isTruck ? TRADE : OTHER).length)]}`;
    const [city, state, zipBase] = CITIES[Math.floor(rand() * CITIES.length)];
    out.push({
      base,
      suffix: SUFFIX[Math.floor(rand() * SUFFIX.length)],
      number: 100 + Math.floor(rand() * 9800),
      dir: DIRS[Math.floor(rand() * DIRS.length)],
      street: STREETS[Math.floor(rand() * STREETS.length)],
      unit: rand() < 0.35 ? String(1 + Math.floor(rand() * 400)) : null,
      city,
      state,
      zip: String(Number(zipBase) + Math.floor(rand() * 40)).padStart(5, "0"),
      naics: isTruck
        ? NAICS_TRUCK[Math.floor(rand() * NAICS_TRUCK.length)]
        : NAICS_OTHER[Math.floor(rand() * NAICS_OTHER.length)],
      isTruck,
      dot: 1000000 + i * 7,
      phone: `${200 + Math.floor(rand() * 700)}${String(Math.floor(rand() * 10000000)).padStart(7, "0")}`,
    });
  }
  return out;
}

// ── spelling variants: the whole point of the dedup test ────────────────────

/** Style 0: "Rivera Hauling LLC" — the plain form. */
/** Style 1: "RIVERA HAULING, L.L.C." — punctuated, uppercased. */
/** Style 2: "The Rivera Hauling Company" — article + expanded suffix. */
/** Style 3: "Rivera Hauling Co., Inc." — doubled suffix. */
function nameVariant(b, style) {
  const dotted = b.suffix.split("").join(".") + ".";
  switch (style % 4) {
    case 1: return `${b.base.toUpperCase()}, ${dotted.toUpperCase()}`;
    case 2: return `The ${b.base} Company`;
    case 3: return `${b.base} Co., Inc.`;
    default: return `${b.base} ${b.suffix}`;
  }
}

/** Street variants that must canonicalize identically. */
function streetVariant(b, style) {
  const long = b.street
    .replace(/\bBlvd\b/, "Boulevard").replace(/\bSt\b/, "Street")
    .replace(/\bDr\b/, "Drive").replace(/\bRd\b/, "Road")
    .replace(/\bAve\b/, "Avenue").replace(/\bPkwy\b/, "Parkway")
    .replace(/\bWay\b/, "Way");
  const longDir = b.dir
    .replace(/^N $/, "North ").replace(/^S $/, "South ")
    .replace(/^E $/, "East ").replace(/^W $/, "West ")
    .replace(/^NW $/, "Northwest ").replace(/^SE $/, "Southeast ");

  switch (style % 3) {
    case 1:
      return `${b.number} ${longDir}${long}${b.unit ? `, Suite ${b.unit}` : ""}`;
    case 2:
      return `${b.number} ${b.dir.trim() ? b.dir.trim() + ". " : ""}${b.street}.${b.unit ? ` #${b.unit}` : ""}`;
    default:
      return `${b.number} ${b.dir}${b.street}${b.unit ? ` Ste ${b.unit}` : ""}`;
  }
}

const money = (rand, lo, hi) => (lo + rand() * (hi - lo)).toFixed(2);
const date = (rand, y0, y1) => {
  const y = y0 + Math.floor(rand() * (y1 - y0 + 1));
  const m = 1 + Math.floor(rand() * 12);
  const d = 1 + Math.floor(rand() * 28);
  return `${m}/${d}/${y}`;
};

// ── the real published headers, column for column ───────────────────────────
const PPP_HEADER = ["LoanNumber", "DateApproved", "SBAOfficeCode", "ProcessingMethod",
  "BorrowerName", "BorrowerAddress", "BorrowerCity", "BorrowerState", "BorrowerZip",
  "LoanStatusDate", "LoanStatus", "Term", "SBAGuarantyPercentage", "InitialApprovalAmount",
  "CurrentApprovalAmount", "UndisbursedAmount", "FranchiseName", "ServicingLenderLocationID",
  "ServicingLenderName", "ServicingLenderAddress", "ServicingLenderCity", "ServicingLenderState",
  "ServicingLenderZip", "RuralUrbanIndicator", "HubzoneIndicator", "LMIIndicator",
  "BusinessAgeDescription", "ProjectCity", "ProjectCountyName", "ProjectState", "ProjectZip",
  "CD", "JobsReported", "NAICSCode", "RaceEthnicity", "Gender", "Veteran", "NonProfit",
  "ForgivenessAmount", "ForgivenessDate", "OriginatingLenderLocationID", "OriginatingLender",
  "OriginatingLenderCity", "OriginatingLenderState", "BusinessType"];

const SBA_HEADER = ["AsOfDate", "Program", "BorrName", "BorrStreet", "BorrCity", "BorrState",
  "BorrZip", "BankName", "BankFDICNumber", "BankNCUANumber", "BankStreet", "BankCity",
  "BankState", "BankZip", "GrossApproval", "SBAGuaranteedApproval", "ApprovalDate",
  "ApprovalFiscalYear", "FirstDisbursementDate", "DeliveryMethod", "subpgmdesc",
  "InitialInterestRate", "TermInMonths", "NaicsCode", "NaicsDescription", "FranchiseCode",
  "FranchiseName", "ProjectCounty", "ProjectState", "SBADistrictOffice",
  "CongressionalDistrict", "BusinessType", "BusinessAge", "LoanStatus", "PaidInFullDate",
  "ChargeOffDate", "GrossChargeOffAmount", "RevolverStatus", "JobsSupported"];

const FMCSA_HEADER = ["DOT_NUMBER", "LEGAL_NAME", "DBA_NAME", "CARRIER_OPERATION", "HM_FLAG",
  "PC_FLAG", "PHY_STREET", "PHY_CITY", "PHY_STATE", "PHY_ZIP", "PHY_COUNTRY", "MAILING_STREET",
  "MAILING_CITY", "MAILING_STATE", "MAILING_ZIP", "MAILING_COUNTRY", "TELEPHONE", "FAX",
  "CELL_PHONE", "EMAIL_ADDRESS", "MCS150_DATE", "MCS150_MILEAGE", "MCS150_MILEAGE_YEAR",
  "ADD_DATE", "OIC_STATE", "NBR_POWER_UNIT", "DRIVER_TOTAL"];

/**
 * Draw `rows` identity indices from [lo, hi), with a slice of deliberate
 * repeats so each file contains the same business more than once.
 */
function drawIndices(rows, lo, hi, rand, repeatRate) {
  const picks = [];
  const span = hi - lo;
  for (let i = 0; i < rows; i++) {
    if (picks.length && rand() < repeatRate) {
      picks.push(picks[Math.floor(rand() * picks.length)]);   // a second draw
    } else {
      picks.push(lo + Math.floor(rand() * span));
    }
  }
  return picks;
}

function writeCsv(file, header, rowsIter) {
  const out = fs.createWriteStream(file);
  out.write(csvLine(header));
  let n = 0;
  for (const row of rowsIter) { out.write(csvLine(row)); n += 1; }
  out.end();
  return new Promise((resolve) => out.on("close", () => resolve(n)));
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, all) => {
      if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]]);
      return acc;
    }, [])
  );
  const ROWS = Number(args.rows || 10000);
  const outDir = path.resolve(args.out || path.join(HERE, "samples"));
  fs.mkdirSync(outDir, { recursive: true });

  const rand = rng(20260727);
  const universe = buildUniverse(26000, rand);

  // Overlapping draw ranges are what create cross-source duplicates:
  //   PPP    0 … 12000
  //   SBA 8000 … 18000   → shares 8000–12000 with PPP
  //   FMCSA 3000 … 7000 and 18000 … 26000
  //                      → shares 3000–7000 with PPP
  const pppPicks = drawIndices(ROWS, 0, 12000, rand, 0.04);
  const sbaPicks = drawIndices(ROWS, 8000, 18000, rand, 0.03);
  const fmcsaPicks = drawIndices(ROWS, 0, 8000, rand, 0.02)
    .map((v, i) => (i % 2 === 0 ? 3000 + (v % 4000) : 18000 + (v % 8000)));

  // ── PPP ───────────────────────────────────────────────────────────────────
  const pppRows = function* () {
    for (let i = 0; i < pppPicks.length; i++) {
      const b = universe[pppPicks[i]];
      const initial = money(rand, 5000, 900000);
      // 1% redacted borrower names — the real release does this for small
      // loans, and the ingester must skip them rather than mail "N/A".
      const redacted = rand() < 0.01;
      // 2% with a blank address.
      const noAddr = rand() < 0.02;
      // 0.5% with a comma+quote in the name, to exercise the CSV parser.
      const messy = rand() < 0.005;

      const name = redacted ? "N/A"
        : messy ? `${b.base}, "The Original", ${b.suffix}`
        : nameVariant(b, i);

      yield [
        String(9000000000 + i * 13), date(rand, 2020, 2021), "0101", i % 3 ? "PPP" : "PPS",
        name, noAddr ? "" : streetVariant(b, i), noAddr ? "" : b.city, b.state, noAddr ? "" : b.zip,
        date(rand, 2021, 2022), rand() < 0.9 ? "Paid in Full" : "Exemption 4",
        "60", "100", initial, initial, "0.00", "",
        String(10000 + i), LENDERS[i % LENDERS.length], "1 Bank Plaza", "Wilmington", "DE", "19801",
        rand() < 0.7 ? "U" : "R", "N", "N", "Existing or more than 2 years old",
        b.city, `${b.city} County`, b.state, b.zip, `${b.state}-01`,
        String(1 + Math.floor(rand() * 40)), b.naics, "Unanswered", "Unanswered", "Unanswered", "N",
        money(rand, 5000, 900000), date(rand, 2021, 2022), String(20000 + i),
        LENDERS[(i + 3) % LENDERS.length], "Wilmington", "DE",
        rand() < 0.5 ? "Limited  Liability Company(LLC)" : "Corporation",
      ];
    }
  };

  // ── SBA 7(a) + 504 ────────────────────────────────────────────────────────
  const sbaRows = function* () {
    for (let i = 0; i < sbaPicks.length; i++) {
      const b = universe[sbaPicks[i]];
      const is504 = rand() < 0.16;             // roughly the real 504:7(a) mix
      const gross = money(rand, 25000, 5000000);
      yield [
        "2026-06-30", is504 ? "504" : "7A", nameVariant(b, i + 1), streetVariant(b, i + 1),
        b.city, b.state, b.zip, LENDERS[(i + 1) % LENDERS.length], String(10000 + i), "",
        "1 Bank Plaza", "Wilmington", "DE", "19801", gross,
        (Number(gross) * 0.75).toFixed(2), date(rand, 2015, 2025),
        String(2015 + Math.floor(rand() * 11)), date(rand, 2015, 2025),
        is504 ? "504" : "7A Standard", is504 ? "504 Loan" : "Guaranty",
        (5 + rand() * 6).toFixed(3), String(60 + Math.floor(rand() * 240)),
        b.naics, b.isTruck ? "General Freight Trucking" : "Services", "", "",
        `${b.city} County`, b.state, b.state + " District Office", `${b.state}-01`,
        "Corporation", "Existing or more than 2 years old",
        rand() < 0.85 ? "PIF" : "CHGOFF", date(rand, 2018, 2025), "", "0.00", "N",
        String(1 + Math.floor(rand() * 60)),
      ];
    }
  };

  // ── FMCSA census — the source that carries contact info ───────────────────
  const fmcsaRows = function* () {
    for (let i = 0; i < fmcsaPicks.length; i++) {
      const b = universe[fmcsaPicks[i]];
      // Contact coverage roughly mirrors the real census: phone on most rows,
      // email on a minority, cell rarer still.
      const hasEmail = rand() < 0.42;
      const hasCell = rand() < 0.22;
      const junkPhone = rand() < 0.03;         // 555 placeholders exist in the real file
      const junkEmail = rand() < 0.02;         // as does literal "UNKNOWN"
      const noPhysical = rand() < 0.06;        // mailing address only
      // 0.3% with an embedded newline inside a quoted field.
      const multiline = rand() < 0.003;

      const legal = multiline
        ? `${b.base}\n${b.suffix}`
        : nameVariant(b, i + 2);
      const street = streetVariant(b, i + 2);
      const slug = b.base.toLowerCase().replace(/[^a-z]+/g, "");

      yield [
        String(b.dot), legal, rand() < 0.3 ? `${b.base} Express` : "",
        rand() < 0.7 ? "A" : "B", "N", "N",
        noPhysical ? "" : street, noPhysical ? "" : b.city, noPhysical ? "" : b.state,
        noPhysical ? "" : b.zip, "US",
        street, b.city, b.state, b.zip, "US",
        junkPhone ? "5555555555" : b.phone,
        rand() < 0.4 ? b.phone : "",
        hasCell ? `${b.phone.slice(0, 3)}${String(Math.floor(rand() * 10000000)).padStart(7, "0")}` : "",
        junkEmail ? "UNKNOWN" : hasEmail ? `dispatch@${slug}.example` : "",
        date(rand, 2019, 2026), String(10000 + Math.floor(rand() * 400000)),
        String(2019 + Math.floor(rand() * 7)), date(rand, 1998, 2020), b.state,
        String(1 + Math.floor(rand() * 60)), String(1 + Math.floor(rand() * 80)),
      ];
    }
  };

  const targets = [
    ["ppp_sample.csv", PPP_HEADER, pppRows],
    ["sba_sample.csv", SBA_HEADER, sbaRows],
    ["fmcsa_sample.csv", FMCSA_HEADER, fmcsaRows],
  ];

  for (const [name, header, rows] of targets) {
    const file = path.join(outDir, name);
    const n = await writeCsv(file, header, rows());
    const size = fs.statSync(file).size;
    console.log(`✔ ${name.padEnd(20)} ${String(n).padStart(6)} rows  ${(size / 1024 / 1024).toFixed(1)}MB`);
  }

  // One gzipped copy, so the ingester's transparent-gunzip path is covered by
  // the proof run too (several federal releases ship .csv.gz).
  const gzSrc = path.join(outDir, "fmcsa_sample.csv");
  const gzDst = `${gzSrc}.gz`;
  fs.writeFileSync(gzDst, zlib.gzipSync(fs.readFileSync(gzSrc)));
  console.log(`✔ ${"fmcsa_sample.csv.gz".padEnd(20)} ${(fs.statSync(gzDst).size / 1024 / 1024).toFixed(1)}MB`);

  console.log(`\nSYNTHETIC sample data — not federal records. Do not mail or dial.`);
  console.log(`Written to ${outDir}`);
}

main().catch((e) => { console.error("FATAL:", e.stack || e.message); process.exit(1); });

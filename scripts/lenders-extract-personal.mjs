#!/usr/bin/env node
/* Pull the PERSONAL cards and personal loans out of the written-up pages, and
   file them under the right product table.
   ---------------------------------------------------------------------------
   WHAT THIS IS FOR, in plain words.

   Every one of the 306 banks in the book is a BUSINESS credit card. There is
   not one personal card, personal loan or personal line of credit in it.

   That is not because we do not have any. Five pages of written-up notes name
   real personal cards and real places to get a personal loan. When those pages
   were read the first time, the personal cards were folded into the BUSINESS
   rows as extra notes — "Alec's favorite personal cards" ended up as a note on
   American Express's business card row. So the personal products became
   footnotes on the wrong rows instead of rows of their own.

   This reads those five pages again and writes the personal products out as
   their own rows, under the right product table.

   ---------------------------------------------------------------------------
   THE RULES IT FOLLOWS.

   1. IT ONLY WRITES WHAT THE PAGE SAYS. Every row carries the page it came
      from and the exact line it came from, in its notes.
   2. IT NEVER GUESSES A NAME. The bank's proper name comes from the same name
      map the bureau pass uses (scripts/lenders-alias-map.json), which is what
      turns "Amex" into "American Express" and "BoA" into "Bank of America".
      A name the map does not know is NOT written — it is listed at the end
      for Chris to name himself.
   3. IT NEVER GUESSES A BUREAU. Which bureau each bank checks comes from the
      credit checks we have actually seen on client reports
      (docs/legacy-strong/inquiry-master-database.csv), read by exactly the
      same rules as the bureau pass. A bank the file has no opinion on gets a
      blank bureau, and blank means unknown.
   4. IT LEAVES BUSINESS CARDS ALONE. One of the five pages has a business
      section. Those rows already exist in the book, and which of the two
      business tables they belong in is not something this script can know. It
      lists them and writes nothing.
   5. IT WRITES THE WHOLE BOOK SHAPE, every column the database knows, so the
      loader cannot blank out a column it never saw. Same rule, same reason,
      as the bureau pass.
   6. IT TOUCHES NO DATABASE.

   ---------------------------------------------------------------------------
   HOW TO RUN IT.

     node scripts/lenders-extract-personal.mjs            <- dry run
     node scripts/lenders-extract-personal.mjs --confirm  <- writes the file

   Then load the file it writes with scripts/lenders-import-alec.mjs --file.
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LENDER_CSV_COLUMNS } from "../src/lenders/tables.mjs";
import {
  SRC_ROOT,
  resolveInstitution,
  readInquiries,
  cleanName,
  escapeCsv,
  sortBureaus,
  toBookText,
  BLOCKED
} from "./lenders-extract-bureaus.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.resolve(HERE, "..");
const OUT_FILE = path.join(OUT_ROOT, "credentials/lenders-audit/lenders-personal.csv");
const CONFIRM = process.argv.includes("--confirm");

const SCRAPE = path.join(SRC_ROOT, "credentials/notion-scrape/output");

/* The five pages, and what each one is a list of. The product table is a
   property of the PAGE, not something worked out per card — the page titles
   say plainly which kind of product they hold. */
const PAGES = [
  {
    dir: "alec-s-favorite-personal-cards--26a2ec40",
    title: "Alec's favorite personal cards",
    table: "PersonalCC",
    reader: readNumberedCards
  },
  {
    dir: "high-limit-personal-cards--9cafa36e",
    title: "High limit personal cards",
    table: "PersonalCC",
    reader: readBareList
  },
  {
    dir: "best-balance-transfer-cards--f9e698f9",
    title: "Best balance transfer cards",
    table: "PersonalCC",
    reader: readBalanceTransferCards
  },
  {
    dir: "personal-loans--677b0a52",
    title: "Personal Loans",
    table: "PersonalLoans",
    reader: readLoanSources
  },
  {
    dir: "balance-transfers--6aaef26e",
    title: "Balance Transfers",
    table: "PersonalCC",
    reader: readNothing
  }
];

function pageLines(dir) {
  const file = path.join(SCRAPE, dir, "page.md");
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8").split(/\r?\n/);
}

/* ────────────────────────── THE FIVE PAGE READERS ──────────────────────────
   One reader per page shape. Each returns { raw, line, detail } — the words
   the page used, which line they were on, and any description that followed.
   None of them decides anything; naming happens in one place further down. */

/** "1. Chase Freedom:" then its Rewards / Perks lines underneath. */
function readNumberedCards(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\d+\.\s*(.+?):\s*$/);
    if (!m) continue;
    const detail = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*\d+\.\s*(.+?):\s*$/.test(lines[j])) break;
      const t = lines[j].trim();
      if (/^(Rewards|Perks|Highlight|Note):/i.test(t)) detail.push(t);
    }
    out.push({ raw: m[1].trim(), line: i + 1, text: lines[i].trim(), detail });
  }
  return out;
}

/** A plain list: one card per line, no colon. A line ending in a colon is a
    heading for the group underneath it, not a card. */
function readBareList(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.startsWith("#") || t.startsWith("Source:")) continue;
    if (t.endsWith(":")) continue;          // group heading
    if (/[.!?]$/.test(t) || t.split(/\s+/).length > 6) continue; // prose, not a card
    out.push({ raw: t, line: i + 1, text: t, detail: [] });
  }
  return out;
}

/** Two sections. Only the personal one is ours; the business one is reported
    and left alone. Card lines end in a colon; so do the labels underneath
    them, which is why the labels are named and skipped. */
const BT_LABEL = /^(Introductory Offer|Balance Transfer Fee|Requirement|Pros|Cons|Benefits|Perks|Rewards)\s*:/i;

function readBalanceTransferCards(lines) {
  const out = [];
  let section = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const sec = t.match(/^(Personal|Business)\s+Balance\s+Transfer\s+Cards\s*:\s*$/i);
    if (sec) { section = sec[1].toLowerCase(); continue; }
    if (!section) continue;
    if (BT_LABEL.test(t)) continue;
    if (!t.endsWith(":")) continue;
    const name = t.slice(0, -1).trim();
    if (!name) continue;
    const detail = [];
    for (let j = i + 1; j < lines.length && j <= i + 4; j++) {
      const d = lines[j].trim();
      if (!d) continue;
      if (d.endsWith(":") && !BT_LABEL.test(d)) break;
      if (BT_LABEL.test(d)) detail.push(d);
    }
    out.push({ raw: name, line: i + 1, text: t, detail, section });
  }
  return out;
}

/** Prose. The lenders are named on "Example:" lines and on the one
    "such as A, B, and C" line. Nothing else on the page names a lender. */
function readLoanSources(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    let listed = null;
    const ex = t.match(/^Example:\s*(.+?)\.?\s*$/i);
    if (ex) listed = ex[1];
    const such = t.match(/\bsuch\s+as\s+(.+?)\.\s*$/i);
    if (!listed && such) listed = such[1];
    if (!listed) continue;
    for (const part of listed.split(/,| and /i)) {
      const raw = part.trim().replace(/\.$/, "");
      if (!raw) continue;
      out.push({ raw, line: i + 1, text: t, detail: [] });
    }
  }
  return out;
}

/** A page that explains a technique and names no lender at all. */
function readNothing() {
  return [];
}

/* ─────────────────────────── NAMING, IN ONE PLACE ───────────────────────────
   A card's name starts with the bank that issues it: "Chase Freedom" is
   Chase's, "Amex Blue Cash" is American Express's. So the bank is found by
   trying the whole name against the name map, then the name with its last
   word removed, and so on until something matches. The FIRST match wins,
   which is the longest one, so "US Bank Cash+" finds "US Bank" and not "US".

   A name that never matches is not written. A name that matches a bank two
   different companies share is not written either — that is the same rule the
   bureau pass follows, and for the same reason. */

function issuerFor(raw) {
  let parts = cleanName(raw).split(" ").filter(Boolean);
  while (parts.length) {
    const hit = resolveInstitution(parts.join(" "));
    if (hit) return { institution: hit, matchedWords: parts.length };
    parts = parts.slice(0, -1);
  }
  return null;
}

/** "Amex Blue Cash" -> "American Express Blue Cash". The bank's own words for
    itself replace whatever short form the page used. Owner rule: full names on
    every screen, so American Express and never Amex.

    An empty answer is the right answer when the page named only a bank and no
    product — "Begin with Wells Fargo" is a bank, not a card. The row still
    says which product table it is in, and a made-up product name would read
    on the screen as a real one. */
function fullProductName(raw, institution, matchedWords) {
  const rest = String(raw).trim()
    .replace(/\([^)]*\)\s*$/, "")     // "(owned by Truist)" is a comment, not a name
    .trim()
    .split(/\s+/).slice(matchedWords).join(" ").trim();
  return rest ? `${institution} ${rest}` : "";
}

function slug(s) {
  return String(s).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/* ═════════════════════════════════ MAIN ═════════════════════════════════ */

function main() {
  const { opinion } = readInquiries();

  const rows = [];
  const unnamed = [];
  const ambiguous = [];
  const businessSection = [];
  const alsoNamed = [];
  const perPage = [];
  const seen = new Map();

  for (const page of PAGES) {
    const lines = pageLines(page.dir);
    if (!lines) {
      perPage.push({ title: page.title, missing: true, found: 0, written: 0 });
      continue;
    }
    const found = page.reader(lines);
    let written = 0;
    for (const item of found) {
      if (item.section === "business") {
        businessSection.push({ page: page.title, raw: item.raw, line: item.line });
        continue;
      }
      const issuer = issuerFor(item.raw);
      if (!issuer) {
        unnamed.push({ page: page.title, raw: item.raw, line: item.line });
        continue;
      }
      if (BLOCKED.has(issuer.institution)) {
        ambiguous.push({ page: page.title, raw: item.raw, institution: issuer.institution });
        continue;
      }
      const product = fullProductName(item.raw, issuer.institution, issuer.matchedWords);
      const key = `${page.table}|${(product || issuer.institution).toLowerCase()}`;
      if (seen.has(key)) {
        // The same card written up on two pages. One row, both pages named.
        seen.get(key).also.push(`${page.title} line ${item.line}`);
        alsoNamed.push({ page: page.title, raw: item.raw, kept: product || issuer.institution });
        continue;
      }
      const view = opinion.get(issuer.institution);
      const bureaus = view && view.bureaus.length ? sortBureaus(new Set(view.bureaus)) : [];
      const row = {
        lender_table: page.table,
        name: issuer.institution,
        product_name: product,
        bureaus_pulled: bureaus.length ? toBookText(bureaus) : "",
        insider_tips: item.detail.join(" "),
        intro_offers: (item.detail.find((d) => /^Introductory Offer:/i.test(d)) || "")
          .replace(/^Introductory Offer:\s*/i, ""),
        notes: `From "${page.title}" (credentials/notion-scrape/output/${page.dir}/page.md), `
          + `line ${item.line}: "${item.text}"`,
        active: "true",
        /* The id has to be built from something that is never empty. A
           personal loan row names only the bank, so `product` is blank on
           those and every one of them would end up with the SAME id — the
           loader upserts on this, so six banks would overwrite each other
           down to one row. Fall back to the bank's name. */
        external_row_id: `PERSONAL-${slug(page.table)}-${slug(product || issuer.institution)}`,
        _bureau_from: view ? view.split : null,
        also: []
      };
      rows.push(row);
      seen.set(key, row);
      written++;
    }
    perPage.push({ title: page.title, found: found.length, written });
  }

  /* THE WHOLE BOOK SHAPE. Every column the database knows about, minus
     logo_path, which the loader works out from the logo files on disk. A
     column this script has nothing for is written empty on every row, which
     is correct: the row is new, so there is nothing to blank out. */
  const header = LENDER_CSV_COLUMNS.filter((c) => c !== "logo_path");
  const csv = [header.join(",")];
  for (const r of rows) csv.push(header.map((c) => escapeCsv(r[c])).join(","));
  const csvText = csv.join("\n") + (rows.length ? "\n" : "");

  console.log("Sources read from : " + SRC_ROOT);
  console.log("");
  for (const p of perPage) {
    if (p.missing) { console.log(`  ${p.title}: PAGE NOT FOUND`); continue; }
    console.log(`  ${p.title}: ${p.found} named, ${p.written} written`);
  }
  console.log("");

  const byTable = {};
  for (const r of rows) byTable[r.lender_table] = (byTable[r.lender_table] || 0) + 1;
  console.log("Rows this would add:", rows.length);
  for (const [t, n] of Object.entries(byTable)) console.log(`  ${t}: ${n}`);
  console.log("With a bureau      :", rows.filter((r) => r.bureaus_pulled).length);
  console.log("");

  console.log("Every row, and where it came from:");
  for (const r of rows) {
    console.log(
      `  ${r.lender_table.padEnd(14)} ${r.product_name || "(the bank itself, no product named)"}`
      + `  [bank: ${r.name}]`
      + `  [bureau: ${r.bureaus_pulled || "unknown"}${r._bureau_from ? " — " + r._bureau_from : ""}]`
    );
  }
  console.log("");

  if (alsoNamed.length) {
    console.log("Named on more than one page — one row each, not two:");
    for (const a of alsoNamed) console.log(`  "${a.raw}" (${a.page}) is already the row "${a.kept}"`);
    console.log("");
  }
  if (businessSection.length) {
    console.log("Business cards on those pages — LEFT ALONE, they are already business rows");
    console.log("and this script cannot know which of the two business tables they belong in:");
    for (const b of businessSection) console.log(`  ${b.raw}  (${b.page}, line ${b.line})`);
    console.log("");
  }
  if (unnamed.length) {
    console.log("Named on a page but not in the bank name map — NOT written, Chris to name:");
    for (const u of unnamed) console.log(`  "${u.raw}"  (${u.page}, line ${u.line})`);
    console.log("");
  }
  if (ambiguous.length) {
    console.log("Two different companies share this name — NOT written, on purpose:");
    for (const a of ambiguous) console.log(`  "${a.raw}" -> ${a.institution}  (${a.page})`);
    console.log("");
  }

  console.log("Columns written:", header.length, "of", LENDER_CSV_COLUMNS.length,
    "(logo_path is filled by the loader from the logo files on disk)");
  console.log("");

  if (!CONFIRM) {
    console.log("DRY RUN. Nothing was written. Add --confirm to write:");
    console.log("  " + OUT_FILE);
    return;
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, csvText);
  console.log("Written:");
  console.log("  " + OUT_FILE);
  console.log("");
  console.log("Load it with:");
  console.log("  node --env-file=.env scripts/lenders-import-alec.mjs \\");
  console.log("    --file credentials/lenders-audit/lenders-personal.csv");
  console.log("(dry run — add --confirm when the numbers look right)");
}

main();

#!/usr/bin/env node
/* Fill in which credit bureau each bank checks, and how good a bank it is.
   ---------------------------------------------------------------------------
   WHAT THIS IS FOR, in plain words.

   When a client applies for a card, the bank checks their credit at one of
   three credit bureaus: Experian, Equifax or TransUnion. Every check leaves a
   mark. Too many marks at one bureau and the next bank says no. So the funding
   advisor is supposed to be handed a list of banks that spreads the checks out.

   That list is built by src/lenders/match.mjs. It cannot spread anything out
   today, because the book of 313 banks only says which bureau the bank checks
   on 3 rows, and says how good the bank is on 0 rows. With nothing to sort by,
   the "rotation plan" comes out in plain A-to-Z order by bank name.

   This script reads every source we hold, works out the bureau and the ranking
   for as many of the 313 as it honestly can, and writes a fresh copy of the
   book with those two columns filled in. It also writes a plain-English review
   file so Chris can see exactly what changed and what is still missing.

   ---------------------------------------------------------------------------
   THE RULES IT FOLLOWS. These are safety rules, not preferences.

   1. A WRONG BUREAU IS WORSE THAN A BLANK ONE. If we write the wrong bureau,
      the advisor sends the client to the exact bureau they were protecting.
      So when two sources disagree, this script writes NOTHING and puts the
      disagreement in the review file for Chris to settle.

   2. IT NEVER INVENTS. A bank with no bureau in any source stays blank, and
      the review file counts it.

   3. IT NEVER OVERWRITES. The three rows that already carry a bureau
      (American Express EX, Citizens Bank EQ, Goldman Sachs TU) are left
      exactly as they are. Same for any other cell that already has something
      in it. This script only fills blanks.

   4. IT WRITES THE WHOLE BOOK BACK, all 45 columns. This one matters. The
      loader (importLendersCsv in src/lenders/store.mjs) hands the WHOLE parsed
      row to updateLender, and the parser (parseLenderCsv in src/lenders/csv.mjs)
      turns an empty cell into a null for every column named in the header. So
      importing a small "just the bureaus" sheet would erase every other column
      on those rows. The output here carries the same 45 column names, in the
      same order, with every original value copied through untouched.

   5. IT TOUCHES NO DATABASE. There is no database code in this file at all.

   ---------------------------------------------------------------------------
   HOW TO RUN IT.

     node scripts/lenders-extract-bureaus.mjs            <- dry run, writes nothing
     node scripts/lenders-extract-bureaus.mjs --confirm  <- writes the two files

   Dry run is the default and it prints exactly what it would change.
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ───────────────────────── WHERE THE FILES LIVE ─────────────────────────
   The sources are not in git. `docs/legacy-strong/` has never been committed
   and `credentials/` is deliberately ignored, so a fresh worktree does not
   have either of them. When this script is running from a worktree it walks
   back up to the main checkout to read them, and still writes everything into
   the worktree it was launched from. It never writes into the main checkout. */

const OUT_ROOT = path.resolve(HERE, "..");

function resolveSourceRoot() {
  if (fs.existsSync(path.join(OUT_ROOT, "docs/legacy-strong/README.md"))) return OUT_ROOT;
  // ".../fundhub-platform/.claude/worktrees/<name>" -> ".../fundhub-platform"
  const marker = `${path.sep}.claude${path.sep}worktrees${path.sep}`;
  const at = OUT_ROOT.indexOf(marker);
  if (at > 0) {
    const main = OUT_ROOT.slice(0, at);
    if (fs.existsSync(path.join(main, "docs/legacy-strong/README.md"))) return main;
  }
  throw new Error(
    "Cannot find docs/legacy-strong/. Looked in " + OUT_ROOT + " and the main checkout above it."
  );
}

export const SRC_ROOT = resolveSourceRoot();

export const SOURCES = {
  book: path.join(SRC_ROOT, "credentials/lenders-audit/lenders-audited.csv"),
  datapoints: path.join(SRC_ROOT, "docs/legacy-strong/bank-datapoints-active-banks.md"),
  inquiries: path.join(SRC_ROOT, "docs/legacy-strong/inquiry-master-database.csv"),
  boards: path.join(SRC_ROOT, "docs/legacy-strong/state-funding-boards.md"),
  notion: {
    "November datapoint drop": path.join(
      SRC_ROOT, "credentials/notion-scrape/output/nov-datapoint-drop-cca-network--29ac3aa7/FULL.md"
    ),
    "The Perfect Funding Sequence": path.join(
      SRC_ROOT, "credentials/notion-scrape/output/the-perfect-funding-sequence--2edc3aa7/FULL.md"
    ),
    "Aged corp details": path.join(
      SRC_ROOT, "credentials/notion-scrape/output/details-aged-corp--1b8c3aa7/FULL.md"
    ),
    "Crafting the Perfect Funding Sequence": path.join(
      SRC_ROOT, "credentials/notion-scrape/output/crafting-the-perfect-funding-sequence--acf9a724/FULL.md"
    )
  }
};

const ALIAS_MAP_FILE = path.join(HERE, "lenders-alias-map.json");
const OUT_BOOK = path.join(OUT_ROOT, "credentials/lenders-audit/lenders-audited-with-bureaus.csv");
const OUT_REVIEW = path.join(OUT_ROOT, "docs/workflows/lender-list-2026-09-05.md");

const CONFIRM = process.argv.includes("--confirm");

/* ───────────────────────── READING A CSV SAFELY ─────────────────────────
   Same quote handling as src/lenders/csv.mjs. A copy on purpose: this script
   must run without importing app code, and the app's splitter is not exported
   in a form a plain script can borrow without pulling the rest in. */

export function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function escapeCsv(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* Reads a CSV where a single cell may contain line breaks (the book has a few).
   Returns { headers, rows } with every cell kept as the exact original text. */
export function readCsv(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/);
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];
  let buf = null;
  for (let i = 1; i < lines.length; i++) {
    buf = buf === null ? lines[i] : `${buf}\n${lines[i]}`;
    // An odd number of quote marks means the row is still open.
    if ((buf.match(/"/g) || []).length % 2 !== 0) continue;
    if (buf.trim() === "") { buf = null; continue; }
    const cells = splitCsvLine(buf);
    const row = {};
    headers.forEach((h, c) => { row[h] = cells[c] == null ? "" : cells[c]; });
    rows.push(row);
    buf = null;
  }
  return { headers, rows };
}

/* ───────────────────── ONE SPELLING OF EACH BANK NAME ─────────────────────
   Exactly the cleaning the alias map documents under how_to_use.step_1. */

export function cleanName(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const aliasMap = JSON.parse(fs.readFileSync(ALIAS_MAP_FILE, "utf8"));
const LOOKUP = new Map(Object.entries(aliasMap.lookup).map(([k, v]) => [cleanName(k), v]));

/* ── NAMES THAT TWO DIFFERENT COMPANIES SHARE — NEVER FILLED IN ──
   The name map lists these under `unresolved`. The book really does hold two
   unrelated banks called "First National Bank" and two called "First Bank",
   and a Notion page names a bureau for one of them without saying which. Fill
   that in and half the rows get the wrong bureau, which is the exact mistake
   that sends a client to the bureau they were protecting. So any bank on this
   list is skipped entirely and listed in the review file instead. */
export const BLOCKED = new Set();
for (const item of (aliasMap.unresolved && aliasMap.unresolved.items) || []) {
  for (const part of String(item.name).split(/\/| vs /i)) {
    const hit = LOOKUP.get(cleanName(part));
    if (hit) BLOCKED.add(hit);
  }
}

/* Words that are a product, not part of the bank's name. Only ever stripped
   from the END of a name, and only these exact words. We never match on part
   of a name: "Prosper" sits inside "Prosperity Bank" and they are two
   different companies. */
const TRAILING_PRODUCT_WORDS = new Set([
  "bloc", "loc", "cc", "rm", "card", "cards", "checking", "account",
  "business", "biz", "personal"
]);

/** Turns any spelling into the one proper bank name, or null if unsure. */
export function resolveInstitution(raw) {
  const direct = LOOKUP.get(cleanName(raw));
  if (direct) return direct;
  // Try again with anything in brackets removed: "First Citizens (30k) RM".
  const noParens = cleanName(String(raw == null ? "" : raw).replace(/\([^)]*\)/g, " "));
  if (LOOKUP.get(noParens)) return LOOKUP.get(noParens);
  // Then peel product words off the end only: "Wells BLOC" -> "Wells".
  let parts = noParens.split(" ").filter(Boolean);
  while (parts.length > 1 && TRAILING_PRODUCT_WORDS.has(parts[parts.length - 1])) {
    parts = parts.slice(0, -1);
    const hit = LOOKUP.get(parts.join(" "));
    if (hit) return hit;
  }
  return null;
}

/* ─────────────────── ONE SPELLING OF EACH BUREAU NAME ───────────────────
   The inquiry file was read off scanned credit reports, so the bureau column
   is full of typos: TrangUnion, Equitax, Exporian, Equilax, Exocrian,
   IransUnion, TranaUnion, and some values with a stray "|" on the end. The
   Notion pages use three different shorthands: EX/EQ/TU, EXP/EQ/TU and
   EXP/EQF/TU. All of it becomes the book's EX / EQ / TU. */

const BUREAU_EXACT = new Map(Object.entries({
  ex: "EX", exp: "EX", experian: "EX",
  eq: "EQ", eqf: "EQ", equifax: "EQ",
  tu: "TU", transunion: "TU", "trans union": "TU"
}));

const BUREAU_FULL_NAMES = [["experian", "EX"], ["equifax", "EQ"], ["transunion", "TU"]];

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const fuzzyBureauFixes = new Map(); // typo seen -> what we read it as

/** One bureau token -> "EX" | "EQ" | "TU" | null. Never guesses wildly: a typo
    only counts when it is within two letters of a full bureau name and about
    the same length. Every typo it accepts is listed in the review file. */
function normaliseBureau(tok) {
  const t = String(tok == null ? "" : tok).toLowerCase().replace(/[^a-z ]+/g, "").trim();
  if (!t) return null;
  const exact = BUREAU_EXACT.get(t);
  if (exact) return exact;
  if (t.length < 6) return null;
  for (const [full, code] of BUREAU_FULL_NAMES) {
    if (Math.abs(full.length - t.length) <= 1 && editDistance(t, full) <= 2) {
      fuzzyBureauFixes.set(tok.trim(), code);
      return code;
    }
  }
  return null;
}

/** A whole cell, which may hold several bureaus, -> a sorted set like ["EX","TU"]. */
function parseBureauCell(cell) {
  const out = new Set();
  for (const tok of String(cell == null ? "" : cell).split(/[\/,;|+\n\r]+/)) {
    const b = normaliseBureau(tok);
    if (b) out.add(b);
  }
  return sortBureaus(out);
}

const BUREAU_ORDER = { EX: 0, EQ: 1, TU: 2 };
export function sortBureaus(set) {
  return [...set].sort((a, b) => BUREAU_ORDER[a] - BUREAU_ORDER[b]);
}
/** The book stores bureaus as one piece of text with slashes: "TU/EX/EQ".
    src/lenders/match.mjs splits on slash, comma, semicolon, plus or a space. */
export function toBookText(list) {
  return list.join("/");
}

/* ═══════════════════════ SOURCE A — THE ACTIVE BANK LIST ═══════════════════
   docs/legacy-strong/bank-datapoints-active-banks.md, 26 banks. This is the
   only source with a real labelled bureau field, so it is trusted first.
   Each row is a stack of lines with no labels:

       AMEX          <- the bank
       39            <- how many datapoints it came from
       HOT           <- how good a bank it is
       EX  TU        <- the bureaus, none to three of them
       NO            <- does the client have to open an account first
       $0            <- how much has to be deposited
       0             <- how many days the money has to sit (not used here)
       NO            <- another flag, meaning not written down anywhere

   Some rows are short. Navy Federal has no bureaus and no day count. So the
   reader takes the lines in order and only accepts what it recognises. */

const HEAT_TO_TIER = { HOT: 1, FAIR: 2, COLD: 3 };

function readDatapoints() {
  const text = fs.readFileSync(SOURCES.datapoints, "utf8");
  const out = [];
  const blocks = text.split(/^##\s+Row\s+\d+\s*$/m).slice(1);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const rawName = lines[0];
    const rec = {
      raw_name: rawName,
      institution: resolveInstitution(rawName),
      bureaus: [],
      tier: null,
      requires_account_opening: null,
      minimum_deposit: null
    };
    let seenHeat = false;
    for (const line of lines.slice(1)) {
      const heat = line.replace(/[^A-Za-z]/g, "").toUpperCase();
      if (!seenHeat) {
        if (HEAT_TO_TIER[heat]) { rec.tier = HEAT_TO_TIER[heat]; seenHeat = true; }
        continue; // the datapoint count sits before the heat word
      }
      const bureau = BUREAU_EXACT.get(line.toLowerCase());
      if (bureau) { rec.bureaus.push(bureau); continue; }
      if (/^(YES|NO)$/i.test(line)) {
        // The first yes/no after the bureaus is "must open an account first".
        // Anything after that is an unlabelled flag we do not understand, so
        // we leave it alone rather than guess what it means.
        if (rec.requires_account_opening === null) {
          rec.requires_account_opening = line.toUpperCase() === "YES" ? "yes" : "no";
        }
        continue;
      }
      const money = line.match(/^\$([\d,]+)$/);
      if (money && rec.minimum_deposit === null) {
        rec.minimum_deposit = Number(money[1].replace(/,/g, ""));
        continue;
      }
    }
    rec.bureaus = sortBureaus(new Set(rec.bureaus));
    out.push(rec);
  }
  return out;
}

/* ═══════════════ SOURCE B — INQUIRIES WE HAVE ACTUALLY SEEN ═══════════════
   docs/legacy-strong/inquiry-master-database.csv. One row per credit check we
   found on a real client's report: which state, which company, which bureau
   it landed on. This is the strongest evidence there is for a bank that the
   active-bank list does not cover.

   It is read by how often, not by whether. A bank whose checks are 90%
   TransUnion checks TransUnion. The thresholds below are deliberately strict,
   because this file is noisy: a lot of the names in it are not lenders at all.

     - fewer than 10 checks for a bank  -> the file has no opinion
     - a bureau under 30% of its checks -> ignored as noise
     - a bureau with fewer than 5 checks -> ignored as noise

   The full split is written into the review file either way, so nothing is
   hidden by a threshold. */

const INQ_MIN_ROWS_PER_BANK = 10;
const INQ_MIN_SHARE = 0.30;
const INQ_MIN_ROWS_PER_BUREAU = 5;

export function readInquiries() {
  const { rows } = readCsv(SOURCES.inquiries);
  const byInstitution = new Map();
  const stats = { total: 0, withCreditor: 0, resolved: 0, unrecognisedBureauCells: new Map() };
  for (const r of rows) {
    stats.total++;
    const name = (r["Creditor Name"] || "").trim();
    if (!name) continue;
    stats.withCreditor++;
    const inst = resolveInstitution(name);
    const cell = (r["Bureau "] != null ? r["Bureau "] : r.Bureau) || "";
    const bureaus = parseBureauCell(cell);
    if (!bureaus.length && cell.trim()) {
      stats.unrecognisedBureauCells.set(
        cell.trim(), (stats.unrecognisedBureauCells.get(cell.trim()) || 0) + 1
      );
    }
    if (!inst) continue;
    stats.resolved++;
    if (!byInstitution.has(inst)) byInstitution.set(inst, { rows: 0, counts: { EX: 0, EQ: 0, TU: 0 } });
    const bucket = byInstitution.get(inst);
    bucket.rows++;
    for (const b of bureaus) bucket.counts[b]++;
  }
  // Turn the counts into an opinion.
  const opinion = new Map();
  for (const [inst, bucket] of byInstitution) {
    const graded = Object.entries(bucket.counts).filter(([, n]) => n > 0);
    const total = graded.reduce((s, [, n]) => s + n, 0);
    const split = graded
      .sort((a, b) => b[1] - a[1])
      .map(([b, n]) => `${b} ${n} (${total ? Math.round((n / total) * 100) : 0}%)`)
      .join(", ");
    let bureaus = [];
    if (bucket.rows >= INQ_MIN_ROWS_PER_BANK && total > 0) {
      bureaus = sortBureaus(new Set(
        graded
          .filter(([, n]) => n >= INQ_MIN_ROWS_PER_BUREAU && n / total >= INQ_MIN_SHARE)
          .map(([b]) => b)
      ));
    }
    opinion.set(inst, { bureaus, rows: bucket.rows, checks: total, split });
  }
  return { opinion, stats };
}

/* ═════════════ SOURCE C — THE WRITTEN-UP NOTION PAGES AND BOARDS ═════════════
   Four prose pages plus the state funding boards table. These are supporting
   evidence: a page written as a worked example is not a labelled field, so it
   can raise a question but it never overrules the two sources above. */

/** "November datapoint drop" — a bank name on its own line, then a line that
    reads "Credit Bureau: TU" or "Credit Bureaus: EXP / TU". */
function readNovDrop(file, label) {
  const found = [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^Credit Bureaus?:\s*(.+)$/i);
    if (!m) continue;
    let name = null;
    for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
      if (lines[j].trim()) { name = lines[j].trim(); break; }
    }
    const bureaus = parseBureauCell(m[1]);
    if (bureaus.length) found.push({ source: label, raw_name: name, bureaus });
  }
  return found;
}

/** "The Perfect Funding Sequence" — a table flattened to one value per line:
    the bank, then STATUS lines, then the bureau shorthand. */
function readFundingSequence(file, label) {
  const found = [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i] || !resolveInstitution(lines[i])) continue;
    for (let j = i + 1; j <= i + 5 && j < lines.length; j++) {
      const b = BUREAU_EXACT.get(lines[j].toLowerCase());
      if (b) { found.push({ source: label, raw_name: lines[i], bureaus: [b] }); break; }
      if (lines[j] && resolveInstitution(lines[j])) break; // ran into the next bank
    }
  }
  return found;
}

/** "Aged corp details" — lines like "First Citizens (30k) RM - 1 EX" or
    "BoA (30k three cards) - 1 EX/TU" or "Citizens (30k) - 1 Soft EQ". */
function readAgedCorp(file, label) {
  const found = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^(.+?)\s+-\s+(\d\s+)?(.+)$/);
    if (!m) continue;
    const bureaus = parseBureauCell(m[3].replace(/\bsoft\b/gi, " "));
    if (!bureaus.length) continue;
    const inst = resolveInstitution(m[1]);
    found.push({ source: label, raw_name: m[1].trim(), bureaus, institution: inst });
  }
  return found;
}

/** "Crafting the Perfect Funding Sequence" — sentences like
    "PNC: Aim for $15k ... (1 pull from Experian)." */
function readCrafting(file, label) {
  const found = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9&.'\- ]+?):\s.*?\(\s*\d*\s*(?:soft\s+)?pull\s+from\s+([^)]+)\)/i);
    if (!m) continue;
    const bureaus = parseBureauCell(m[2]);
    if (bureaus.length) found.push({ source: label, raw_name: m[1].trim(), bureaus });
  }
  return found;
}

/** State funding boards — each row is a stack of lines, and some rows carry a
    proper bank name and a bureau written out in full. The link on every row is
    cut short with a "…", so this source cannot fill an application link. */
function readBoards() {
  const text = fs.readFileSync(SOURCES.boards, "utf8");
  const found = [];
  const urls = { total: 0, truncated: 0, usable: [] };
  const blocks = text.split(/^##\s+Row\s+\d+\s*$/m).slice(1);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const bureaus = new Set();
    let inst = null;
    for (const line of lines) {
      const b = BUREAU_EXACT.get(line.toLowerCase());
      if (b) { bureaus.add(b); continue; }
      const hit = resolveInstitution(line);
      if (hit && !inst) inst = hit;
      if (/^(https?:\/\/|[a-z0-9-]+\.[a-z]{2,}\/)/i.test(line)) {
        urls.total++;
        if (line.includes("…") || line.includes("...")) urls.truncated++;
        else urls.usable.push({ institution: inst, url: line });
      }
    }
    if (inst && bureaus.size) {
      found.push({ source: "State funding boards", raw_name: inst, bureaus: sortBureaus(bureaus) });
    }
  }
  return { found, urls };
}

function readSupportingSources() {
  const claims = [];
  const unresolved = new Map();
  claims.push(...readNovDrop(SOURCES.notion["November datapoint drop"], "November datapoint drop"));
  claims.push(...readFundingSequence(SOURCES.notion["The Perfect Funding Sequence"], "The Perfect Funding Sequence"));
  claims.push(...readAgedCorp(SOURCES.notion["Aged corp details"], "Aged corp details"));
  claims.push(...readCrafting(SOURCES.notion["Crafting the Perfect Funding Sequence"], "Crafting the Perfect Funding Sequence"));
  const boards = readBoards();
  claims.push(...boards.found);

  const byInstitution = new Map();
  for (const c of claims) {
    const inst = c.institution || resolveInstitution(c.raw_name);
    if (!inst) {
      const key = `${c.raw_name} (${c.source})`;
      unresolved.set(key, (unresolved.get(key) || 0) + 1);
      continue;
    }
    if (!byInstitution.has(inst)) byInstitution.set(inst, []);
    byInstitution.get(inst).push({ source: c.source, bureaus: c.bureaus });
  }
  return { byInstitution, unresolved, boardUrls: boards.urls, claimCount: claims.length };
}

/* ═══════════════════════════ PUTTING IT TOGETHER ═══════════════════════════

   For each bank:
     - the ACTIVE BANK LIST and the SEEN INQUIRIES are strong evidence.
     - the written-up pages are supporting evidence.

   The first strong source that has an opinion is the answer. The active bank
   list comes first because the bureau is written in a labelled field there.
   The inquiries we have seen come second.

   If a second strong source names a bureau the first one leaves out, that is a
   real disagreement: the bank is left BLANK and listed as a conflict for Chris.
   That is the First Citizens case — the active bank list says Equifax, and the
   inquiries we have seen include five Experian pulls.

   If the second source is only naming fewer bureaus than the first, that is not
   a disagreement. A labelled field listing three bureaus is more complete than
   a sample of client reports that happened to show two of them.

   If a written-up page names a bureau the strong sources do not, that is not
   enough to block anything. The strong answer is written and the disagreement
   is recorded as a note, so Chris can still see it.

   If there is no strong source at all, the written-up pages are used, but only
   when they agree with each other. If two pages disagree, blank and report. */

function decideBureaus(inst, datapoint, inquiry, supportingRaw) {
  // The same page can say the same thing more than once. Say it once here.
  const seen = new Set();
  const supporting = (supportingRaw || []).filter((s) => {
    const key = `${s.source}|${sortBureaus(new Set(s.bureaus)).join("/")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const strong = [];
  if (datapoint && datapoint.bureaus.length) {
    strong.push({ source: "Active bank list", bureaus: datapoint.bureaus });
  }
  if (inquiry && inquiry.bureaus.length) {
    strong.push({ source: `Inquiries we have seen (${inquiry.split})`, bureaus: inquiry.bureaus });
  }
  const notes = [];

  if (strong.length) {
    const primary = strong[0];
    // A disagreement is a second strong source naming a bureau the first one
    // leaves out. A second source naming fewer is not a disagreement.
    const disagrees = strong.slice(1).some(
      (s) => s.bureaus.some((b) => !primary.bureaus.includes(b))
    );
    if (disagrees) {
      return { value: null, conflict: { institution: inst, claims: strong }, notes };
    }
    const decided = sortBureaus(new Set(primary.bureaus));
    for (const s of supporting) {
      const extra = s.bureaus.filter((b) => !decided.includes(b));
      if (extra.length) {
        notes.push({ institution: inst, decided, source: s.source, says: s.bureaus });
      }
    }
    return { value: decided, from: primary.source, notes };
  }

  if (!supporting.length) return { value: null, notes };

  // Only the written-up pages have anything. They must agree with each other.
  const bySource = new Map();
  for (const s of supporting) {
    const key = sortBureaus(new Set(s.bureaus)).join("/");
    if (!bySource.has(key)) bySource.set(key, new Set());
    bySource.get(key).add(s.source);
  }
  if (bySource.size > 1) {
    return {
      value: null,
      conflict: {
        institution: inst,
        claims: [...bySource].map(([k, srcs]) => ({ source: [...srcs].join(", "), bureaus: k.split("/") }))
      },
      notes
    };
  }
  const only = supporting[0];
  return {
    value: sortBureaus(new Set(only.bureaus)),
    from: `Written-up pages (${[...new Set(supporting.map((s) => s.source))].join(", ")})`,
    notes
  };
}

/* ═════════════════════════════════ MAIN ═════════════════════════════════ */

function main() {
  const book = readCsv(SOURCES.book);
  const datapoints = readDatapoints();
  const { opinion: inquiryOpinion, stats: inquiryStats } = readInquiries();
  const supporting = readSupportingSources();

  const datapointByInstitution = new Map();
  for (const d of datapoints) if (d.institution) datapointByInstitution.set(d.institution, d);

  // Which banks actually have a row in the book.
  const bookRowsByInstitution = new Map();
  const unmatchedBookRows = [];
  for (const row of book.rows) {
    const inst = resolveInstitution(row.name);
    row.__institution = inst;
    if (!inst) { unmatchedBookRows.push(row.name); continue; }
    if (!bookRowsByInstitution.has(inst)) bookRowsByInstitution.set(inst, []);
    bookRowsByInstitution.get(inst).push(row);
  }

  // Work out one answer per bank, then stamp it onto every row for that bank.
  const decisions = new Map();
  const conflicts = [];
  const notes = [];
  for (const inst of bookRowsByInstitution.keys()) {
    const d = decideBureaus(
      inst,
      datapointByInstitution.get(inst),
      inquiryOpinion.get(inst),
      supporting.byInstitution.get(inst) || []
    );
    if (d.conflict) conflicts.push(d.conflict);
    for (const n of d.notes) notes.push(n);
    decisions.set(inst, d);
  }

  // Banks whose name two different companies share. Held back on purpose.
  const blockedReport = [];
  for (const inst of BLOCKED) {
    const rows = bookRowsByInstitution.get(inst);
    if (!rows || !rows.length) continue;
    const d2 = decisions.get(inst);
    blockedReport.push({
      institution: inst,
      rows: rows.length,
      states: rows.map((r) => `${r.lender_table} (${r.eligible_states || "no states"})`).join("; "),
      sourcesSay: d2 && d2.value ? toBookText(d2.value) : "nothing"
    });
  }

  const junkIds = new Set((aliasMap.rows_to_delete_not_banks.rows || []).map((r) => r.external_row_id));

  const changes = {
    bureaus: [], tier: [], deposit: [], accountOpening: [], url: [],
    lockedRowsLeftAlone: [], junkRowsSeen: []
  };

  for (const row of book.rows) {
    if (junkIds.has(row.external_row_id)) changes.junkRowsSeen.push(row);
    const inst = row.__institution;
    if (!inst) continue;
    if (BLOCKED.has(inst)) continue; // two different banks share this name

    const decided = decisions.get(inst);
    const already = (row.bureaus_pulled || "").trim();
    if (already) {
      const wouldBe = decided && decided.value ? toBookText(decided.value) : null;
      if (wouldBe && wouldBe !== already) {
        changes.lockedRowsLeftAlone.push({ name: row.name, keeps: already, sourcesSay: wouldBe });
      }
      // Rule 3: never overwrite. Nothing happens to this cell.
    } else if (decided && decided.value) {
      row.__new_bureaus = toBookText(decided.value);
      changes.bureaus.push({ name: row.name, value: row.__new_bureaus, from: decided.from, institution: inst });
    }

    const dp = datapointByInstitution.get(inst);
    if (dp) {
      if (!(row.priority_tier || "").trim() && dp.tier != null) {
        row.__new_tier = String(dp.tier);
        changes.tier.push({ name: row.name, value: dp.tier, institution: inst });
      }
      if (!(row.minimum_deposit || "").trim() && dp.minimum_deposit != null) {
        row.__new_deposit = String(dp.minimum_deposit);
        changes.deposit.push({ name: row.name, value: dp.minimum_deposit, institution: inst });
      }
      if (!(row.requires_account_opening || "").trim() && dp.requires_account_opening != null) {
        row.__new_account_opening = dp.requires_account_opening;
        changes.accountOpening.push({ name: row.name, value: dp.requires_account_opening, institution: inst });
      }
    }

    // Application links. The state funding boards is the only source that
    // offers any, and every one of them is cut short with a "…", so nothing
    // can be filled from it. The code is here so the count is honest.
    if (!(row.application_url || "").trim()) {
      const hit = supporting.boardUrls.usable.find((u) => u.institution === inst);
      if (hit) {
        row.__new_url = hit.url;
        changes.url.push({ name: row.name, value: hit.url, institution: inst });
      }
    }
  }

  const outRows = book.rows.map((row) => {
    const copy = {};
    for (const h of book.headers) copy[h] = row[h];
    if (row.__new_bureaus) copy.bureaus_pulled = row.__new_bureaus;
    if (row.__new_tier) copy.priority_tier = row.__new_tier;
    if (row.__new_deposit) copy.minimum_deposit = row.__new_deposit;
    if (row.__new_account_opening) copy.requires_account_opening = row.__new_account_opening;
    if (row.__new_url) copy.application_url = row.__new_url;
    return copy;
  });

  const csvOut = [
    book.headers.join(","),
    ...outRows.map((r) => book.headers.map((h) => escapeCsv(r[h])).join(","))
  ].join("\n") + "\n";

  const before = {
    bureaus: book.rows.filter((r) => (r.bureaus_pulled || "").trim()).length,
    tier: book.rows.filter((r) => (r.priority_tier || "").trim()).length,
    deposit: book.rows.filter((r) => (r.minimum_deposit || "").trim()).length,
    accountOpening: book.rows.filter((r) => (r.requires_account_opening || "").trim()).length,
    url: book.rows.filter((r) => (r.application_url || "").trim()).length
  };
  const after = {
    bureaus: outRows.filter((r) => (r.bureaus_pulled || "").trim()).length,
    tier: outRows.filter((r) => (r.priority_tier || "").trim()).length,
    deposit: outRows.filter((r) => (r.minimum_deposit || "").trim()).length,
    accountOpening: outRows.filter((r) => (r.requires_account_opening || "").trim()).length,
    url: outRows.filter((r) => (r.application_url || "").trim()).length
  };

  const stillBlank = outRows
    .filter((r) => !(r.bureaus_pulled || "").trim())
    .map((r) => {
      const inst = resolveInstitution(r.name);
      let why = "No bureau in any source we hold.";
      if (!inst) why = "Bank name not recognised, so no source could be attached to it.";
      else if (BLOCKED.has(inst)) why = "Two different banks share this name — filling it in would be a coin flip.";
      else if (conflicts.some((c) => c.institution === inst)) why = "Sources disagree — needs Chris to rule.";
      return { name: r.name, table: r.lender_table, institution: inst, why };
    });

  /* ── Safety check on the output, run every time, dry run included ──
     If any of these fail the file would erase live data on import. */
  const guards = [];
  if (book.headers.length !== 45) guards.push(`Book header is ${book.headers.length} columns, expected 45.`);
  if (book.headers.join(",") !== Object.keys(outRows[0] || {}).join(",")) {
    guards.push("Output columns are not the same, or not in the same order, as the book's.");
  }
  if (outRows.length !== book.rows.length) guards.push("Row count changed.");
  let wiped = 0;
  book.rows.forEach((src, i) => {
    for (const h of book.headers) {
      const had = (src[h] || "").trim();
      const now = (outRows[i][h] || "").trim();
      if (had && now !== had) wiped++;
    }
  });
  if (wiped) guards.push(`${wiped} cells that already had a value would be changed. Nothing should be.`);

  const report = buildReport({
    before, after, changes, conflicts, notes, stillBlank, unmatchedBookRows, blockedReport,
    inquiryStats, inquiryOpinion, supporting, datapoints, datapointByInstitution,
    bookRowsByInstitution, guards, bookRowCount: book.rows.length
  });

  /* ── What the run prints ── */
  console.log("");
  console.log("Sources read from : " + SRC_ROOT);
  console.log("Output would go to: " + OUT_ROOT);
  console.log("");
  console.log(`Book rows                     ${book.rows.length}`);
  console.log(`Bureau filled in    ${String(before.bureaus).padStart(4)}  ->  ${after.bureaus}`);
  console.log(`Ranking filled in   ${String(before.tier).padStart(4)}  ->  ${after.tier}`);
  console.log(`Deposit filled in   ${String(before.deposit).padStart(4)}  ->  ${after.deposit}`);
  console.log(`Open an account?    ${String(before.accountOpening).padStart(4)}  ->  ${after.accountOpening}`);
  console.log(`Application link    ${String(before.url).padStart(4)}  ->  ${after.url}`);
  console.log("");
  console.log(`Banks that sources disagree on, left blank: ${conflicts.length}`);
  for (const c of conflicts) {
    console.log(`  ${c.institution}: ` + c.claims.map((x) => `${x.source} says ${x.bureaus.join("/")}`).join("  |  "));
  }
  console.log(`Banks held back because two companies share the name: ${blockedReport.length}`);
  for (const b of blockedReport) console.log(`  ${b.institution}: ${b.rows} row${b.rows === 1 ? "" : "s"}, a source says ${b.sourcesSay}`);
  console.log(`Notes where a written-up page adds a bureau: ${notes.length}`);
  console.log(`Rows that already had a bureau and keep it: ${changes.lockedRowsLeftAlone.length} flagged, 3 total locked`);
  console.log(`Rows still with no bureau: ${stillBlank.length}`);
  console.log(`Rows in the book that are not banks: ${changes.junkRowsSeen.length}`);
  console.log("");
  console.log(guards.length ? "SAFETY CHECK FAILED:\n  " + guards.join("\n  ") : "Safety check passed: no existing value is touched, all 45 columns kept.");
  console.log("");

  if (!CONFIRM) {
    console.log("DRY RUN. Nothing was written. Add --confirm to write:");
    console.log("  " + OUT_BOOK);
    console.log("  " + OUT_REVIEW);
    return;
  }
  if (guards.length) {
    console.log("Refusing to write because the safety check failed.");
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(path.dirname(OUT_BOOK), { recursive: true });
  fs.mkdirSync(path.dirname(OUT_REVIEW), { recursive: true });
  fs.writeFileSync(OUT_BOOK, csvOut);
  fs.writeFileSync(OUT_REVIEW, report);
  console.log("Written:");
  console.log("  " + OUT_BOOK);
  console.log("  " + OUT_REVIEW);
}

/* ═══════════════════ THE REVIEW FILE, WRITTEN FOR CHRIS ═══════════════════ */

function buildReport(d) {
  const L = [];
  const p = (s = "") => L.push(s);

  p("# The bank list: which bureau each bank checks");
  p("");
  p("Written 2026-09-05 by `scripts/lenders-extract-bureaus.mjs`. Nothing here was typed by hand.");
  p("");
  p("## Why this was needed");
  p("");
  p("When a client applies for a card, the bank checks their credit at one of three");
  p("credit bureaus: Experian, Equifax or TransUnion. Every check leaves a mark, and");
  p("too many marks at one bureau gets the next application turned down. The funding");
  p("advisor's screen is meant to hand out a list that spreads those checks around.");
  p("");
  p("It could not. Out of " + d.bookRowCount + " banks in the book, only 3 said which bureau they check");
  p("and none said how good a bank it is. With nothing to sort on, the \"rotation plan\"");
  p("came out in plain A-to-Z order by bank name. It was doing nothing at all.");
  p("");
  p("## What changed");
  p("");
  p("| | Before | After |");
  p("|---|---|---|");
  p(`| Banks that say which bureau they check | ${d.before.bureaus} | ${d.after.bureaus} |`);
  p(`| Banks with a good/fair/poor ranking | ${d.before.tier} | ${d.after.tier} |`);
  p(`| Banks with a minimum deposit written down | ${d.before.deposit} | ${d.after.deposit} |`);
  p(`| Banks that say whether you must open an account | ${d.before.accountOpening} | ${d.after.accountOpening} |`);
  p(`| Banks with an application link | ${d.before.url} | ${d.after.url} |`);
  p("");
  p("Ranking means 1 for the banks Alec's notes mark HOT, 2 for FAIR, 3 for COLD.");
  p("That is the column the advisor's list sorts on first.");
  p("");

  p("## The three rows that already had a bureau were not touched");
  p("");
  p("American Express (Experian), Citizens Bank (Equifax) and Goldman Sachs (TransUnion)");
  p("were filled in before this run. This script never overwrites a cell that already has");
  p("something in it, so all three are exactly as they were.");
  if (d.changes.lockedRowsLeftAlone.length) {
    p("");
    p("Where a source disagreed with one of those existing values, it was left alone and noted here:");
    p("");
    p("| Row | Keeps | A source says |");
    p("|---|---|---|");
    for (const r of d.changes.lockedRowsLeftAlone) p(`| ${r.name} | ${r.keeps} | ${r.sourcesSay} |`);
  }
  p("");

  p("## Banks where the sources disagree — left blank on purpose");
  p("");
  p("A wrong bureau is worse than a blank one: it sends the client to the exact bureau");
  p("they were protecting. So when two solid sources say different things, the script");
  p("writes nothing and puts the bank here for you to settle.");
  p("");
  if (!d.conflicts.length) {
    p("None.");
  } else {
    p("| Bank | What each source says |");
    p("|---|---|");
    for (const c of d.conflicts) {
      p(`| ${c.institution} | ` + c.claims.map((x) => `**${x.bureaus.join("/")}** — ${x.source}`).join("<br>") + " |");
    }
  }
  p("");

  p("## Banks held back because two companies share the name");
  p("");
  p("The book has two unrelated banks called First National Bank, two called First Bank,");
  p("and two called First American Bank. A Notion page names a bureau for \"First National");
  p("Bank\" without saying which one it means. Filling that in would be a coin flip, and half");
  p("the rows would get the wrong bureau. So these are left blank until you say which is which.");
  p("");
  if (!d.blockedReport.length) {
    p("None have a row in the book.");
  } else {
    p("| Bank | Rows | Which rows | A source says |");
    p("|---|---|---|---|");
    for (const b of d.blockedReport) p(`| ${b.institution} | ${b.rows} | ${b.states} | ${b.sourcesSay} |`);
  }
  p("");

  p("## Smaller disagreements — filled in, but worth a look");
  p("");
  p("Here the solid sources agreed, so the bank got filled in. A written-up Notion page");
  p("mentions a bureau on top of that. Not enough to block anything, but you should see it.");
  p("");
  if (!d.notes.length) {
    p("None.");
  } else {
    p("| Bank | Written in | The page says | Which page |");
    p("|---|---|---|---|");
    for (const n of d.notes) p(`| ${n.institution} | ${n.decided.join("/")} | ${n.says.join("/")} | ${n.source} |`);
  }
  p("");

  p("## Banks that the book lists more than once");
  p("");
  p("The book calls the same bank by several different names, so one bank can be spread");
  p("over several rows. Every row in a group below now carries the same bureau and the");
  p("same ranking. The rows were not merged — that is a separate decision for you — but");
  p("they are no longer treated as different banks.");
  p("");
  p("One split is deliberate and was kept: a bank can have one row for the card you apply");
  p("for online and another for the card you have to walk into a branch for.");
  p("");
  p("| Bank | Rows in the book | The row names |");
  p("|---|---|---|");
  const groups = (aliasMap.book_collapses && aliasMap.book_collapses.groups) || {};
  for (const [canonical, rows] of Object.entries(groups)) {
    p(`| ${canonical} | ${rows.length} | ${rows.map((r) => r.name).join("; ")} |`);
  }
  p("");

  p("## Seven rows in the book that are not banks");
  p("");
  p("These are stacking instructions — sentences telling the advisor how to apply — that");
  p("got read in as if they were bank names. Each is sitting on a state, and every one of");
  p("those states is already covered by an Elan Financial row. They should be deleted.");
  p("This script does not delete anything.");
  p("");
  p("| State it is holding | The row's name |");
  p("|---|---|");
  for (const r of (aliasMap.rows_to_delete_not_banks.rows || [])) {
    p(`| ${r.state_it_is_holding} | ${r.name} |`);
  }
  p("");

  p("## Banks that still have no bureau, and why");
  p("");
  p(`${d.stillBlank.length} of the ${d.bookRowCount} rows still have nothing. Grouped by the reason:`);
  p("");
  const byReason = new Map();
  for (const r of d.stillBlank) {
    if (!byReason.has(r.why)) byReason.set(r.why, []);
    byReason.get(r.why).push(r.name);
  }
  for (const [why, names] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
    p(`**${names.length} rows — ${why}**`);
    p("");
    p(names.slice(0, 40).join(", ") + (names.length > 40 ? `, and ${names.length - 40} more.` : ""));
    p("");
  }
  p("Almost all of these are small local banks that appear on exactly one row and are");
  p("named in no other source we hold. There is no honest way to fill them in from what");
  p("we have. They would have to come from a real application or a call to the bank.");
  p("");

  p("## Active banks with no row in the book at all");
  p("");
  p("Alec's active bank list has 26 banks. Ten of them have no row in the book, so there");
  p("is nothing to attach their bureau to. That is the real ceiling on this job: 16 banks,");
  p("not 26.");
  p("");
  p("| Bank | Ranking | Bureau in the note |");
  p("|---|---|---|");
  for (const b of (aliasMap.sources_still_missing_from_the_book.active_bank_datapoints_with_no_book_row || [])) {
    p(`| ${b.bank} | ${b.heat} | ${b.bureaus_in_datapoint} |`);
  }
  p("");

  p("## Where the answers came from");
  p("");
  p("Four kinds of source, ranked. Higher beats lower.");
  p("");
  p("1. **Alec's active bank list** (`docs/legacy-strong/bank-datapoints-active-banks.md`).");
  p("   26 banks, with the bureau written in a labelled field. Trusted most.");
  p(`   Read: ${d.datapoints.length} banks, ${d.datapointByInstitution.size} of them named properly.`);
  p("2. **Credit checks we have actually seen** (`docs/legacy-strong/inquiry-master-database.csv`).");
  p(`   ${d.inquiryStats.withCreditor} real credit checks off client reports. ${d.inquiryStats.resolved} of them are on a bank we can name.`);
  p("   A bank is only given a bureau here when we have seen at least 10 of its checks, and");
  p("   the bureau accounts for at least 30% of them and at least 5 checks. The full split is below.");
  p("3. **The written-up Notion pages** (four of them) and the state funding boards table.");
  p(`   ${d.supporting.claimCount} statements found. These can raise a question but never overrule the two above.`);
  p("");
  p("### What the credit checks we have seen actually show");
  p("");
  p("Every bank we could name, and how its checks split across the three bureaus. The last");
  p("column is what this file alone would say. Where the active bank list also has an opinion,");
  p("that one wins, so the bureau written into the book can be wider than this column.");
  p("");
  p("| Bank | Checks seen | How they split | What this file on its own concludes |");
  p("|---|---|---|---|");
  const inqRows = [...d.inquiryOpinion.entries()].sort((a, b) => b[1].checks - a[1].checks);
  for (const [inst, o] of inqRows) {
    p(`| ${inst} | ${o.checks} | ${o.split} | ${o.bureaus.length ? o.bureaus.join("/") : "too thin to use"} |`);
  }
  p("");

  p("### Typos in the scanned reports that were read through");
  p("");
  p("The credit checks file was read off scanned credit reports, so the bureau column has");
  p("misspellings in it. These were read as follows. Nothing else was guessed at.");
  p("");
  if (!fuzzyBureauFixes.size) {
    p("None needed.");
  } else {
    p("| What the file says | Read as |");
    p("|---|---|");
    for (const [typo, code] of [...fuzzyBureauFixes].sort()) p(`| ${typo} | ${code} |`);
  }
  p("");
  const unreadable = [...d.inquiryStats.unrecognisedBureauCells].sort((a, b) => b[1] - a[1]);
  if (unreadable.length) {
    p("These bureau entries could not be read at all and were ignored:");
    p("");
    for (const [cell, n] of unreadable) p(`- \`${cell.replace(/\n/g, " ")}\` — ${n} row${n === 1 ? "" : "s"}`);
    p("");
  }

  p("## Application links: nothing could be filled");
  p("");
  p(`${d.before.url} of the ${d.bookRowCount} rows have an application link and ${d.bookRowCount - d.before.url} do not.`);
  p("The state funding boards table was the one source that offers links, and it could not");
  p(`help: all ${d.supporting.boardUrls.total} of its links were cut short when the page was copied out of Notion.`);
  p("They read like `bmo.com/en-…tinum/` — the middle of the address is literally missing.");
  p("Writing one of those in would give the advisor a link that goes nowhere, so none were written.");
  p("");
  p("To fix this properly, someone has to open the State Funding Boards page in Notion and");
  p("copy the full links out. There are about 8 different links behind those 29 rows.");
  p("");

  p("## Names in the sources that could not be pinned to one bank");
  p("");
  p("Left alone rather than guessed at.");
  p("");
  if (!d.supporting.unresolved.size) {
    p("None.");
  } else {
    for (const [name, n] of [...d.supporting.unresolved].sort((a, b) => b[1] - a[1])) {
      p(`- ${name} — mentioned ${n} time${n === 1 ? "" : "s"}`);
    }
  }
  p("");
  p("And from the name map, already known:");
  p("");
  for (const u of (aliasMap.unresolved.items || [])) p(`- **${u.name}** — ${u.why}`);
  p("");

  p("## Safety check");
  p("");
  p("The new file has to be the whole book, all 45 columns. The importer hands every column");
  p("it sees straight into the database, and an empty cell counts as an instruction to clear");
  p("that field. A cut-down \"just the bureaus\" sheet would wipe every other column on those");
  p("rows. So the file written here carries every original value through untouched.");
  p("");
  p(d.guards.length ? "**CHECK FAILED:**\n\n- " + d.guards.join("\n- ") : "Checked and passed: same 45 columns in the same order, same number of rows, and no cell that already had a value was changed.");
  p("");

  p("## What Chris needs to decide");
  p("");
  p("1. The banks in the disagreement table above — which bureau is right.");
  p("2. Whether to delete the seven rows that are not banks.");
  p("3. Whether to merge the duplicate rows into one row per bank.");
  p("4. Whether someone should pull the full application links out of Notion.");
  p("");
  return L.join("\n") + "\n";
}

/* Only run when this file IS the command. scripts/lenders-extract-personal.mjs
   imports the readers above rather than writing a second copy of them, and an
   import must not kick off a whole extraction run. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

// Post-seed audit of the workflow layer.
//
// The point of message_templates is that changing customer-facing copy is a data
// edit, not a code edit. This audit reports the two ways that promise is still
// broken:
//
//   1. DANGLING KEYS  — a workflow file names a template_key that has no row.
//                       Rendering it would fail (or worse, send nothing).
//   2. HARDCODED COPY — a workflow file carries the message text inline instead
//                       of pulling it from message_templates. Someone would have
//                       to edit code to change what a client reads.
//
// Reported only. Nothing here rewrites a workflow — that is not this task's lane.
//
// Scanning is done over real string literals (via a small state scanner) rather
// than raw regex over the file, so prose inside `//` comments — of which this
// codebase has plenty — is not mistaken for copy.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");

// Where workflow/reaction code lives (or will live — the ~60 Inngest workflow
// ports are Phase 2). Directories that do not exist yet are skipped. Deliberately
// excludes scripts/ and src/events/: dev tooling and the bus carry no client copy.
export const DEFAULT_ROOTS = ["src/workflows", "src/handlers", "src/messaging", "api"];

// The seeder is not a workflow: it necessarily contains template keys and copy.
const EXCLUDED = [path.join("src", "messaging", "seed")];

export function listWorkflowFiles(root = REPO_ROOT, roots = DEFAULT_ROOTS) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (EXCLUDED.some((x) => rel === x || rel.startsWith(`${x}${path.sep}`))) continue;
      if (entry.isDirectory()) walk(full);
      else if (/\.(mjs|js)$/.test(entry.name) && !/\.test\.mjs$/.test(entry.name)) out.push(rel);
    }
  };
  for (const r of roots) walk(path.join(root, r));
  return out;
}

// Minimal JS scanner: yields string/template literals with their line numbers and
// skips comments entirely.
export function stringLiterals(source) {
  const out = [];
  const s = String(source);
  let i = 0;
  let line = 1;
  while (i < s.length) {
    const c = s[i];
    const next = s[i + 1];
    if (c === "\n") { line += 1; i += 1; continue; }
    if (c === "/" && next === "/") { while (i < s.length && s[i] !== "\n") i += 1; continue; }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) { if (s[i] === "\n") line += 1; i += 1; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const startLine = line;
      const quote = c;
      const start = i;
      let value = "";
      i += 1;
      while (i < s.length && s[i] !== quote) {
        if (s[i] === "\\") { value += s[i + 1] ?? ""; i += 2; continue; }
        if (s[i] === "\n") line += 1;
        value += s[i];
        i += 1;
      }
      i += 1;
      out.push({ value, quote, line: startLine, start, end: i });
      continue;
    }
    i += 1;
  }
  return out;
}

// Given the SQL literal of a `db.query(SQL, [params])` call, return the literals
// that sit in the rest of that call — i.e. the bound parameters. Walks forward
// from the end of the SQL until the enclosing call's paren closes, stepping over
// any string literals so their parens do not confuse the depth count.
function literalsInSameCall(literals, sqlLiteral, source) {
  const s = String(source);
  let depth = 0;
  let i = sqlLiteral.end;
  const byStart = literals.filter((l) => l.start >= sqlLiteral.end);
  while (i < s.length) {
    const inString = byStart.find((l) => i >= l.start && i < l.end);
    if (inString) { i = inString.end; continue; }
    const c = s[i];
    if (c === "(" || c === "[") depth += 1;
    else if (c === "]") depth -= 1;
    else if (c === ")") {
      if (depth === 0) break; // the closing paren of db.query(
      depth -= 1;
    }
    i += 1;
  }
  return byStart.filter((l) => l.end <= i);
}

const SQL_WORDS = /\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ON\s+CONFLICT|VALUES\s*\(|RETURNING|LIMIT\s+\d)\b/i;
const isSql = (v) => SQL_WORDS.test(v);

// An explicit template_key reference: `template_key: "X"`, `templateKey: 'X'`,
// render("X"), renderTemplate("X"), sendTemplate("X"), template("X").
const EXPLICIT_KEY_REF =
  /(?:template_key|templateKey|renderTemplate|sendTemplate|template)\s*[:(=]\s*["'`]([^"'`]+)["'`]/g;

/* Shape-based: anything that looks like one of our template keys, wherever it
   appears.

   THIS USED TO BE SMS-ONLY, AND THAT MADE THE AUDIT LIE. The explicit-reference
   pattern above only fires on a literal written directly at the call site
   (`templateKey: "X"`). Not one workflow file does that — every one of them
   hoists the key into a module constant first:

     const EMAIL_TEMPLATE_KEY = "EMAIL-F03-ROUND-SUBMITTED";
     ... sendTemplated(db, { ..., templateKey: EMAIL_TEMPLATE_KEY })

   `EMAIL_TEMPLATE_KEY = "..."` does not match EXPLICIT_KEY_REF (the name ends
   `_KEY`, not `template`, and the pattern is case-sensitive), so the shape test
   below was the only thing catching these — and it only knew about `SMS-`.
   Result: every SMS key was found and roughly half the real keys, all the
   `EMAIL-` ones, were invisible. An audit that reports "nothing uses this
   template" about a template nineteen workflows send is worse than no audit,
   because it reads as permission to change the key.

   Widened on the owner's instruction, 2026-08-01, at the same time the template
   editor started using this function to decide whether a key is safe to rename. */
const TEMPLATE_KEY_SHAPE = /^(?:SMS|EMAIL)-[A-Z0-9]/;

export function findTemplateKeyRefs(source) {
  const refs = new Map(); // key -> first line seen
  for (const m of String(source).matchAll(EXPLICIT_KEY_REF)) {
    const upto = String(source).slice(0, m.index);
    const line = upto.split("\n").length;
    if (!refs.has(m[1])) refs.set(m[1], line);
  }
  for (const lit of stringLiterals(source)) {
    if (TEMPLATE_KEY_SHAPE.test(lit.value) && !refs.has(lit.value)) refs.set(lit.value, lit.line);
  }
  return [...refs].map(([key, line]) => ({ key, line }));
}

// Copy a client would actually read, hardcoded in the file. Two detectors, both
// deliberately narrow — an audit that flags every capitalised string is an audit
// nobody reads:
//
//   merge tags  — a literal containing {{…}} is template copy by definition.
//   copy column — a literal bound as a parameter of an INSERT INTO messages/tasks
//                 that writes a copy-bearing column (rendered_body, body, title,
//                 subject). Catches copy with no merge tags in it at all.
const COPY_COLUMNS = /\b(rendered_body|subject|title|body)\b/i;

export function findHardcodedCopy(source) {
  const literals = stringLiterals(source);
  const hits = [];
  const seen = new Set();
  const add = (lit, why) => {
    const id = `${lit.line}:${lit.value}`;
    if (seen.has(id)) return;
    seen.add(id);
    hits.push({ line: lit.line, text: lit.value, why });
  };

  for (const lit of literals) {
    if (isSql(lit.value)) continue;
    if (/\{\{[^{}]+\}\}/.test(lit.value)) add(lit, "contains merge tags");
  }

  for (const lit of literals) {
    const m = lit.value.match(/INSERT\s+INTO\s+(messages|tasks)\s*\(([^)]*)\)/i);
    if (!m || !COPY_COLUMNS.test(m[2])) continue;
    for (const param of literalsInSameCall(literals, lit, source)) {
      const v = param.value.trim();
      if (isSql(v)) continue;
      // Enum-ish fallbacks ('sms', 'twilio', 'completed') are not copy.
      if (!/\s/.test(v) && !(v.length >= 10 && /^[A-Z]/.test(v))) continue;
      add(param, `bound into ${m[1]} (${m[2].replace(/\s+/g, " ").trim()})`);
    }
  }

  return hits.sort((a, b) => a.line - b.line);
}

// Outbound message rows written with no template_key column at all — structurally
// unable to trace what copy was sent. Inbound rows are exempt (a client's reply
// has no template).
export function findUntemplatedOutboundInserts(source) {
  const hits = [];
  for (const lit of stringLiterals(source)) {
    const v = lit.value;
    const m = v.match(/INSERT\s+INTO\s+messages\s*\(([^)]*)\)/i);
    if (!m) continue;
    if (/\btemplate_key\b/i.test(m[1])) continue;
    // Inbound rows are exempt — a client's reply was never rendered from a
    // template. Only a literal 'outbound', or a direction bound at run time,
    // counts.
    if (/'inbound'/i.test(v)) continue;
    if (!/'outbound'/i.test(v) && !/\bdirection\b/i.test(m[1])) continue;
    hits.push({ line: lit.line, columns: m[1].replace(/\s+/g, " ").trim() });
  }
  return hits;
}

// seededKeys: Set|Array of template_key values that now exist as rows.
export function auditWorkflows(seededKeys, { root = REPO_ROOT, roots = DEFAULT_ROOTS } = {}) {
  const known = new Set(seededKeys);
  const files = listWorkflowFiles(root, roots);
  const danglingKeys = [];
  const hardcodedCopy = [];
  const untemplatedOutbound = [];

  for (const rel of files) {
    const source = fs.readFileSync(path.join(root, rel), "utf8");
    for (const ref of findTemplateKeyRefs(source)) {
      if (!known.has(ref.key)) danglingKeys.push({ file: rel, line: ref.line, templateKey: ref.key });
    }
    for (const hit of findHardcodedCopy(source)) hardcodedCopy.push({ file: rel, ...hit });
    for (const hit of findUntemplatedOutboundInserts(source)) untemplatedOutbound.push({ file: rel, ...hit });
  }

  return { scannedFiles: files, danglingKeys, hardcodedCopy, untemplatedOutbound };
}

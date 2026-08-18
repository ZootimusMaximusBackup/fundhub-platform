// W11 read-only: map table writers/readers and INSERT/UPDATE columns.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../../");
const DIRS = ["api", "src", "db"];
const SKIP_DIR = new Set(["node_modules", ".git", "dist", "coverage", "playwright-report"]);
const EXT = new Set([".mjs", ".js", ".sql", ".ts"]);

const tables = JSON.parse(fs.readFileSync(path.join(HERE, "row_counts.json"), "utf8"))
  .map((r) => r.table)
  .sort((a, b) => b.length - a.length);
const columns = JSON.parse(fs.readFileSync(path.join(HERE, "columns.json"), "utf8"));
const colsByTable = new Map();
for (const c of columns) {
  if (!colsByTable.has(c.table_name)) colsByTable.set(c.table_name, new Set());
  colsByTable.get(c.table_name).add(c.column_name);
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

function classify(rel) {
  if (/\.test\.(mjs|js|ts)$/.test(rel) || /\/test\//.test(rel) || rel.includes(".pg.test.")) {
    return "test";
  }
  if (rel.startsWith("db/migrations/") || rel.startsWith("db/schema/") || rel.startsWith("db/seed/")) {
    return "db_schema";
  }
  if (rel.startsWith("db/")) return "db_other";
  if (rel.startsWith("api/")) return "api";
  if (rel.startsWith("src/")) return "src";
  return "other";
}

function parseInsertColumns(sqlAfterTable) {
  const m = sqlAfterTable.match(/^\s*\(([^)]*)\)/s);
  if (!m) return null;
  const inner = m[1];
  if (/\$\{/.test(inner)) return { dynamic: true, columns: [] };
  const cols = inner
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, "").split(/\s+/)[0])
    .filter((s) => s && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s));
  return { dynamic: false, columns: cols };
}

function parseUpdateColumns(sqlAfterTable) {
  const m = sqlAfterTable.match(/^\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+|\s+RETURNING\s+|$)/i);
  if (!m) return [];
  const body = m[1];
  const cols = [];
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g;
  let x;
  while ((x = re.exec(body))) cols.push(x[1]);
  return cols;
}

const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const perTable = new Map();
function bucket(table) {
  if (!perTable.has(table)) {
    perTable.set(table, {
      writers: { api: [], src: [], db_schema: [], db_other: [], test: [] },
      readers: { api: [], src: [], db_schema: [], db_other: [], test: [] },
      insert_columns: new Set(),
      update_columns: new Set(),
      insert_dynamic: false,
      writer_files: new Set(),
      reader_files: new Set()
    });
  }
  return perTable.get(table);
}

const insertRe = /\bINSERT\s+INTO\s+(?:public\.)?["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?/gi;
const updateRe = /\bUPDATE\s+(?:ONLY\s+)?(?:public\.)?["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?/gi;
const deleteRe = /\bDELETE\s+FROM\s+(?:ONLY\s+)?(?:public\.)?["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?/gi;
const fromRe = /\b(?:FROM|JOIN)\s+(?:public\.)?["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?/gi;

const known = new Set(tables);

for (const abs of files) {
  const rel = path.relative(ROOT, abs);
  const kind = classify(rel);
  let text;
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    continue;
  }
  const hits = [];

  function collect(re, role) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const name = m[1];
      if (!known.has(name)) continue;
      hits.push({ name, role, index: m.index, after: text.slice(m.index + m[0].length, m.index + m[0].length + 800) });
    }
  }
  collect(insertRe, "insert");
  collect(updateRe, "update");
  collect(deleteRe, "delete");
  collect(fromRe, "select");

  const seenWrite = new Set();
  const seenRead = new Set();
  for (const h of hits) {
    const b = bucket(h.name);
    if (h.role === "insert" || h.role === "update" || h.role === "delete") {
      if (!seenWrite.has(h.name)) {
        seenWrite.add(h.name);
        b.writers[kind].push(rel);
        b.writer_files.add(rel);
      }
      if (h.role === "insert") {
        const parsed = parseInsertColumns(h.after);
        if (parsed?.dynamic) b.insert_dynamic = true;
        if (parsed?.columns) for (const c of parsed.columns) b.insert_columns.add(c);
      }
      if (h.role === "update") {
        for (const c of parseUpdateColumns(h.after)) b.update_columns.add(c);
      }
    } else if (!seenRead.has(h.name)) {
      seenRead.add(h.name);
      b.readers[kind].push(rel);
      b.reader_files.add(rel);
    }
  }
}

const usage = [];
const dead = [];
const runtimeUnused = [];
const missingLiveColumns = [];
const unwrittenLiveColumns = [];

for (const table of tables.slice().sort()) {
  const b = perTable.get(table) || {
    writers: { api: [], src: [], db_schema: [], db_other: [], test: [] },
    readers: { api: [], src: [], db_schema: [], db_other: [], test: [] },
    insert_columns: new Set(),
    update_columns: new Set(),
    insert_dynamic: false,
    writer_files: new Set(),
    reader_files: new Set()
  };
  const writers = [...b.writer_files].sort();
  const readers = [...b.reader_files].sort();
  const runtimeWriters = [...b.writers.api, ...b.writers.src];
  const runtimeReaders = [...b.readers.api, ...b.readers.src];
  const rec = {
    table,
    writer_count: writers.length,
    reader_count: readers.length,
    writers: {
      api: b.writers.api.sort(),
      src: b.writers.src.sort(),
      db_schema: b.writers.db_schema.sort(),
      test: b.writers.test.sort()
    },
    readers: {
      api: b.readers.api.sort(),
      src: b.readers.src.sort(),
      db_schema: b.readers.db_schema.sort(),
      test: b.readers.test.sort()
    },
    insert_columns: [...b.insert_columns].sort(),
    update_columns: [...b.update_columns].sort(),
    insert_dynamic: b.insert_dynamic
  };
  usage.push(rec);

  if (writers.length === 0 && readers.length === 0) dead.push(table);
  if (runtimeWriters.length === 0 && runtimeReaders.length === 0) {
    runtimeUnused.push({
      table,
      has_db_schema_write: b.writers.db_schema.length > 0,
      has_db_schema_read: b.readers.db_schema.length > 0,
      has_test_write: b.writers.test.length > 0,
      has_test_read: b.readers.test.length > 0
    });
  }

  const live = colsByTable.get(table) || new Set();
  const written = new Set([...b.insert_columns, ...b.update_columns]);
  for (const c of written) {
    if (!live.has(c)) {
      missingLiveColumns.push({ table, column: c, via: b.insert_columns.has(c) ? "INSERT" : "UPDATE" });
    }
  }
  const skip = new Set(["id", "created_at", "updated_at", "archived_at"]);
  if (!b.insert_dynamic && written.size > 0) {
    for (const c of live) {
      if (skip.has(c)) continue;
      if (!written.has(c)) {
        unwrittenLiveColumns.push({ table, column: c });
      }
    }
  }
}

fs.writeFileSync(path.join(HERE, "table_usage.json"), JSON.stringify(usage, null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "dead_tables.json"), JSON.stringify(dead, null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "runtime_unused.json"), JSON.stringify(runtimeUnused, null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "column_drift_missing_on_live.json"), JSON.stringify(missingLiveColumns, null, 2) + "\n");
fs.writeFileSync(path.join(HERE, "column_drift_unwritten.json"), JSON.stringify(unwrittenLiveColumns, null, 2) + "\n");

const summary = {
  tables: tables.length,
  files_scanned: files.length,
  dead_no_sql_at_all: dead,
  runtime_unused_count: runtimeUnused.length,
  missing_on_live_count: missingLiveColumns.length,
  unwritten_count: unwrittenLiveColumns.length
};
fs.writeFileSync(path.join(HERE, "scan_summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));

#!/usr/bin/env node
// Ingest one federal source into the marketing warehouse.
//
//   node scripts/marketing/ingest.mjs <ppp|sba|fmcsa> [options]
//
// Options
//   --limit N        stop after N data rows (sample mode; aborts the download)
//   --file PATH      read a local file instead of downloading
//   --url URL        download one explicit URL instead of discovering
//   --list           list the files that would be ingested, then exit
//   --batch N        rows per transaction (default 2000)
//   --rate MS        minimum ms between HTTP requests (default 1000)
//   --keep-raw       store each source row verbatim in business_sources.attrs
//   --dry-run        parse + normalize + report, write nothing
//   --org SLUG       load into a non-default org (default: the default org)
//
// Examples
//   # 10k-row sample, straight off the wire
//   node scripts/marketing/ingest.mjs fmcsa --limit 10000
//
//   # full scale, from a file already on disk (the recommended path)
//   node scripts/marketing/ingest.mjs ppp --file /data/ppp/public_150k_plus.csv
//
// Re-running is always safe: every write is an upsert keyed on canonical
// identity, so a repeated load updates rows instead of duplicating them.

import { pool, close } from "../../src/db.mjs";
import { openSource, RateLimiter } from "./lib/fetch.mjs";
import { readMapped } from "./lib/csv.mjs";
import { SOURCES, toRecord, tagsFor } from "./lib/sources.mjs";
import { Warehouse, resolveOrgId } from "./lib/warehouse.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { args._.push(a); continue; }
    const key = a.slice(2);
    const flags = ["list", "keep-raw", "dry-run", "help"];
    if (flags.includes(key)) { args[key] = true; continue; }
    args[key] = argv[++i];
  }
  return args;
}

function fmtInt(n) { return Number(n).toLocaleString("en-US"); }

function fmtBytes(n) {
  if (!n) return "?";
  const units = ["B", "KB", "MB", "GB"];
  let v = n, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
  return `${v.toFixed(1)}${units[u]}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const key = args._[0];

  if (args.help || !key || !SOURCES[key]) {
    console.error(
      `usage: node scripts/marketing/ingest.mjs <${Object.keys(SOURCES).join("|")}> [options]\n` +
      `       see the header of this file, or scripts/marketing/README.md`
    );
    process.exit(key ? 1 : 0);
  }

  const source = SOURCES[key];
  const limit = args.limit ? Number(args.limit) : Infinity;
  const batchSize = Number(args.batch || 2000);
  const rateMs = Number(args.rate ?? 1000);
  const keepRaw = Boolean(args["keep-raw"] || process.env.MARKETING_KEEP_RAW === "1");
  const dryRun = Boolean(args["dry-run"]);

  // ── which files ────────────────────────────────────────────────────────────
  let files;
  if (args.file) {
    files = [{ file: args.file, name: args.file.split("/").pop(), bytes: null }];
  } else if (args.url || process.env[source.envUrl]) {
    const url = args.url || process.env[source.envUrl];
    files = [{ url, name: url.split("/").pop().split("?")[0], bytes: null }];
  } else {
    console.error(`· discovering ${source.label} files…`);
    files = await source.resolveFiles();
  }

  if (!files.length) throw new Error(`${key}: no files resolved`);

  console.error(`· ${source.label}`);
  console.error(`  authority : ${source.authority}`);
  console.error(`  tags      : ${tagsFor(source).join(", ")}`);
  console.error(`  files     : ${files.length}`);
  for (const f of files) console.error(`    - ${f.name}${f.bytes ? ` (${fmtBytes(f.bytes)})` : ""}`);

  if (args.list) return;

  // ── where it goes ──────────────────────────────────────────────────────────
  let db = null;
  let warehouse = null;
  let orgId = null;

  if (!dryRun) {
    db = pool();
    orgId = await resolveOrgId(db, args.org);
    warehouse = new Warehouse(db, { orgId, batchSize });
    await warehouse.startRun({ source: tagsFor(source)[0], sourceFile: files.map((f) => f.name).join(",") });
  }

  const rateLimiter = new RateLimiter(rateMs);
  const controller = new AbortController();
  const stats = { read: 0, skipped: 0, inserted: 0, updated: 0, bytes: 0, files: 0 };
  const sampleRows = [];
  const started = Date.now();
  let lastLog = 0;

  const report = () => {
    const secs = Math.max(1, (Date.now() - started) / 1000);
    console.error(
      `  … ${fmtInt(stats.read)} rows | ${fmtInt(stats.inserted)} new | ` +
      `${fmtInt(stats.updated)} merged | ${fmtInt(stats.skipped)} skipped | ` +
      `${Math.round(stats.read / secs)}/s`
    );
  };

  try {
    outer:
    for (const f of files) {
      if (stats.read >= limit) break;
      stats.files += 1;
      console.error(`· reading ${f.name}`);

      const chunks = openSource({
        url: f.url,
        file: f.file,
        rateLimiter,
        signal: controller.signal,
        onProgress: (p) => { if (p.kind === "bytes") stats.bytes = p.bytes; },
      });

      let batch = [];
      let warnedMissing = false;

      for await (const { values, raw, rowNumber, missing } of readMapped(chunks, source.fields, { keepRaw })) {
        // Surface a header mismatch once per file — a silently unmapped
        // column is how a load "succeeds" with every phone number empty.
        if (!warnedMissing) {
          warnedMissing = true;
          if (missing.length) console.error(`  ⚠ columns not found in header: ${missing.join(", ")}`);
        }

        stats.read += 1;
        const record = toRecord(source, values, { sourceFile: f.name, rowNumber, raw });
        if (!record) { stats.skipped += 1; }
        else if (dryRun) { if (sampleRows.length < 5) sampleRows.push(record); }
        else { batch.push(record); }

        if (batch.length >= batchSize) {
          const r = await warehouse.writeBatch(batch);
          stats.inserted += r.inserted;
          stats.updated += r.updated;
          batch = [];
          if (Date.now() - lastLog > 5000) { lastLog = Date.now(); report(); }
        }

        if (stats.read >= limit) {
          // Stop pulling from the agency the moment we have enough. The
          // generator's finally-block aborts the in-flight request.
          controller.abort();
          if (batch.length && !dryRun) {
            const r = await warehouse.writeBatch(batch);
            stats.inserted += r.inserted;
            stats.updated += r.updated;
            batch = [];
          }
          break outer;
        }
      }

      if (batch.length && !dryRun) {
        const r = await warehouse.writeBatch(batch);
        stats.inserted += r.inserted;
        stats.updated += r.updated;
      }

      if (warehouse) {
        warehouse.stats.read = stats.read;
        warehouse.stats.skipped = stats.skipped;
        warehouse.stats.bytes = stats.bytes;
        await warehouse.heartbeat();
      }
    }

    if (warehouse) {
      warehouse.stats.read = stats.read;
      warehouse.stats.skipped = stats.skipped;
      warehouse.stats.bytes = stats.bytes;
      await warehouse.finishRun({ status: "completed" });
    }
  } catch (err) {
    if (warehouse) await warehouse.finishRun({ status: "failed", error: String(err?.message || err) }).catch(() => {});
    throw err;
  } finally {
    controller.abort();
  }

  // ── summary ────────────────────────────────────────────────────────────────
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.error("");
  console.error(`✔ ${source.label} — ${dryRun ? "DRY RUN" : "ingested"} in ${secs}s`);
  console.error(`  files read     : ${stats.files}`);
  console.error(`  rows read      : ${fmtInt(stats.read)}`);
  console.error(`  rows skipped   : ${fmtInt(stats.skipped)}  (no usable business name)`);
  if (!dryRun) {
    console.error(`  businesses new : ${fmtInt(stats.inserted)}`);
    console.error(`  merged/updated : ${fmtInt(stats.updated)}  (already present — deduped)`);
  }
  console.error(`  bytes read     : ${fmtBytes(stats.bytes)}`);
  if (Number.isFinite(limit)) {
    const pct = ((stats.read / source.estimatedRecords) * 100).toFixed(2);
    console.error(
      `  NOTE: sample of ${fmtInt(stats.read)} rows — ` +
      `${pct}% of the ~${fmtInt(source.estimatedRecords)}-record full source.`
    );
  }

  if (dryRun && sampleRows.length) {
    console.error("\n  first normalized records:");
    for (const r of sampleRows) {
      console.error(`    ${JSON.stringify({
        name: r.name, nameKey: r.nameKey, addressKey: r.addressKey,
        phone: r.phone, email: r.email, source: r.source, id: r.sourceRecordId,
      })}`);
    }
  }

  if (db) await close();
}

main().catch(async (err) => {
  console.error(`FATAL: ${err?.stack || err?.message || err}`);
  await close().catch(() => {});
  process.exit(1);
});

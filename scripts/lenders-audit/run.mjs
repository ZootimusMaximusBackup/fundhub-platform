#!/usr/bin/env node
/**
 * Full lender logo + application URL audit.
 *
 * Reads credentials/notion-scrape/output/lenders-legacy-strong.csv
 * Writes credentials/lenders-audit/manifest.json + AUDIT-REPORT.md
 * Downloads logos to public/assets/lenders/{slug}.png
 *
 * Usage: node scripts/lenders-audit/run.mjs [--limit N] [--skip-verify]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLenderCsv } from "../../src/lenders/csv.mjs";
import { slugFromName, normalizeName, isTipRow } from "./normalize.mjs";
import { lookupInstitution } from "./known-institutions.mjs";
import { verifyApplicationUrl, pickBestUrl } from "./verify-url.mjs";
import { fetchLogoForDomain, domainFromUrl } from "./fetch-logo.mjs";
import { discoverApplyUrl } from "./discover-url.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CSV_PATH = path.join(ROOT, "credentials/notion-scrape/output/lenders-legacy-strong.csv");
const OUT_DIR = path.join(ROOT, "credentials/lenders-audit");
const LOGO_DIR = path.join(ROOT, "public/assets/lenders");
const MANIFEST_PATH = path.join(OUT_DIR, "manifest.json");
const REPORT_PATH = path.join(OUT_DIR, "AUDIT-REPORT.md");

const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : null;
const skipVerify = args.includes("--skip-verify");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Group rows by institution slug. */
function groupRows(rows) {
  /** @type {Map<string, { slug: string, name: string, rows: object[] }>} */
  const groups = new Map();
  for (const row of rows) {
    if (isTipRow(row.name)) continue;
    const name = normalizeName(row.name);
    const slug = slugFromName(name);
    if (!groups.has(slug)) groups.set(slug, { slug, name, rows: [] });
    groups.get(slug).rows.push(row);
  }
  return groups;
}

function resolveDomain(slug, name, url) {
  const known = lookupInstitution(name);
  if (known?.domain) return known.domain;
  const fromUrl = domainFromUrl(url);
  if (fromUrl && !/creditcardlearnmore|commonsenselenders|mycommunitycc|elancard/i.test(fromUrl)) {
    return fromUrl;
  }
  if (fromUrl) return fromUrl;
  return null;
}

function resolveCandidateUrls(group) {
  const urls = [];
  const known = lookupInstitution(group.name);
  if (known?.applyUrl) urls.push(known.applyUrl);
  for (const r of group.rows) {
    if (r.application_url) urls.push(r.application_url);
  }
  return [...new Set(urls)];
}

async function auditGroup(group) {
  const candidateUrls = resolveCandidateUrls(group);
  let applicationUrl = null;
  let verify = { ok: false, reason: "no_url", status: 0, finalUrl: null };
  let discovered = null;

  if (candidateUrls.length && !skipVerify) {
    const picked = await pickBestUrl(candidateUrls);
    if (picked) {
      applicationUrl = picked.url;
      verify = picked.verify;
    }
  } else if (candidateUrls.length) {
    applicationUrl = candidateUrls[0];
    verify = { ok: true, reason: "skipped_verify", status: 0, finalUrl: applicationUrl };
  }

  // Reject wrong-institution URLs (e.g. First Citizens URL on Citizens Bank row)
  const known = lookupInstitution(group.name);
  if (known?.applyUrl && applicationUrl) {
    const appHost = domainFromUrl(applicationUrl);
    const knownHost = known.domain;
    if (appHost && knownHost && appHost !== knownHost && !appHost.endsWith(knownHost)) {
      applicationUrl = known.applyUrl;
      verify = skipVerify
        ? { ok: true, reason: "institution_override", finalUrl: applicationUrl }
        : await verifyApplicationUrl(applicationUrl);
    }
  }

  if (!applicationUrl) {
    discovered = await discoverApplyUrl(group.name);
    if (discovered.application_url) {
      applicationUrl = discovered.application_url;
      verify = skipVerify
        ? { ok: true, reason: "discovered", finalUrl: applicationUrl }
        : await verifyApplicationUrl(applicationUrl);
    }
  }

  const domain = resolveDomain(group.slug, group.name, applicationUrl) || discovered?.domain || null;
  const logoFile = `${group.slug}.png`;
  const logoPath = `/assets/lenders/${logoFile}`;
  const logoAbs = path.join(LOGO_DIR, logoFile);

  let logo = { ok: false, reason: "no_domain" };
  if (domain) {
    logo = await fetchLogoForDomain(domain, logoAbs);
    await sleep(120);
  }

  const status = (verify.ok || (applicationUrl && logo.ok && /credit|card|apply|elancard|learnmore|fnbo/i.test(applicationUrl)))
    && logo.ok
    ? "complete"
    : verify.ok && !logo.ok
      ? "url_ok_logo_missing"
      : !verify.ok && logo.ok && applicationUrl
        ? "logo_ok_url_unverified"
        : applicationUrl
          ? "partial"
          : "needs_research";

  return {
    slug: group.slug,
    name: group.name,
    domain,
    logo_path: logo.ok ? logoPath : null,
    logo,
    application_url: applicationUrl,
    verify,
    status,
    external_row_ids: group.rows.map((r) => r.external_row_id).filter(Boolean),
    row_count: group.rows.length,
    prior_urls: group.rows.map((r) => r.application_url).filter(Boolean)
  };
}

function renderReport(manifest, tipRows) {
  const lines = [
    "# Lender logo + application URL audit",
    "",
    `Generated: ${manifest.generated_at}`,
    `Source CSV: \`${path.relative(ROOT, CSV_PATH)}\``,
    "",
    "## Summary",
    "",
    "| Status | Count |",
    "|--------|------:|"
  ];
  for (const [k, v] of Object.entries(manifest.summary)) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push("", `Tip/junk rows skipped: **${tipRows.length}**`, "");

  lines.push("## Complete (verified URL + logo)", "");
  for (const e of manifest.entries.filter((x) => x.status === "complete")) {
    lines.push(`- **${e.name}** — [apply](${e.application_url}) · logo \`${e.logo_path}\``);
  }

  lines.push("", "## URL verified, logo missing", "");
  for (const e of manifest.entries.filter((x) => x.status === "url_ok_logo_missing")) {
    lines.push(`- **${e.name}** — [apply](${e.application_url}) · domain \`${e.domain || "?"}\``);
  }

  lines.push("", "## Needs research (no verified apply URL)", "");
  for (const e of manifest.entries.filter((x) => x.status === "needs_research" || x.status === "partial")) {
    lines.push(`- **${e.name}** (${e.row_count} rows) — prior: ${(e.prior_urls[0] || "none").slice(0, 80)}`);
  }

  lines.push("", "## URL failed verification", "");
  for (const e of manifest.entries.filter((x) => x.verify && !x.verify.ok && x.application_url)) {
    lines.push(`- **${e.name}** — ${e.application_url} (${e.verify.reason})`);
  }

  return lines.join("\n");
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error("Missing CSV:", CSV_PATH);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(LOGO_DIR, { recursive: true });

  const { rows, errors } = parseLenderCsv(fs.readFileSync(CSV_PATH, "utf8"));
  if (errors.length) console.warn("CSV parse warnings:", errors.slice(0, 5));

  const tipRows = rows.filter((r) => isTipRow(r.name));
  const groups = groupRows(rows);
  let entries = [...groups.values()];
  if (limit) entries = entries.slice(0, limit);

  console.log(`Auditing ${entries.length} institutions (${rows.length} CSV rows, ${tipRows.length} tips skipped)...`);

  /** @type {object[]} */
  const results = [];
  for (let i = 0; i < entries.length; i++) {
    const g = entries[i];
    process.stdout.write(`[${i + 1}/${entries.length}] ${g.name}... `);
    const r = await auditGroup(g);
    results.push(r);
    console.log(r.status);
  }

  const summary = {
    complete: results.filter((r) => r.status === "complete").length,
    url_ok_logo_missing: results.filter((r) => r.status === "url_ok_logo_missing").length,
    logo_ok_url_failed: results.filter((r) => r.status === "logo_ok_url_failed").length,
    partial: results.filter((r) => r.status === "partial").length,
    needs_research: results.filter((r) => r.status === "needs_research").length,
    institutions: results.length,
    csv_rows: rows.length
  };

  const manifest = {
    generated_at: new Date().toISOString(),
    source_csv: path.relative(ROOT, CSV_PATH),
    summary,
    tip_rows_skipped: tipRows.map((r) => ({ name: r.name, external_row_id: r.external_row_id })),
    entries: results
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  fs.writeFileSync(REPORT_PATH, renderReport(manifest, tipRows));

  console.log("\nDone.");
  console.log("Summary:", summary);
  console.log("Manifest:", MANIFEST_PATH);
  console.log("Report:", REPORT_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

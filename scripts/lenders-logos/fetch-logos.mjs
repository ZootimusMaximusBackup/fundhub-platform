#!/usr/bin/env node
/**
 * Get a real logo for every bank in the book that is missing one or has a wrong one.
 *
 * What it does, in plain English:
 *   1. Goes to the bank's own website.
 *   2. Checks the page actually says that bank's name. If it says a different
 *      company, we stop and report it — we never save another company's logo.
 *   3. Takes the picture the bank publishes for phone home screens, which is the
 *      real brand mark, and saves it as a PNG.
 *   4. Refuses anything too small to read, and refuses the specific junk pictures
 *      the previous run saved by mistake.
 *
 * Nothing is fetched when the site is shown. These are files on disk, downloaded
 * once. The website is not contacted when a screen loads.
 *
 * Usage:
 *   node scripts/lenders-logos/fetch-logos.mjs            # missing banks only
 *   node scripts/lenders-logos/fetch-logos.mjs --wrong    # replace wrong pictures
 *   node scripts/lenders-logos/fetch-logos.mjs --all
 *   node scripts/lenders-logos/fetch-logos.mjs --dry-run  # look, save nothing
 *   node scripts/lenders-logos/fetch-logos.mjs --out /path/to/public/assets/lenders
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MISSING, WRONG, NOT_A_BANK } from "./targets.mjs";
import { readSiteIcons, siteBelongsToBank, saveImage, sleep } from "./sources.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);

const dryRun = has("--dry-run");
const doWrong = has("--wrong") || has("--all");
const doMissing = has("--all") || !has("--wrong");

// The logos are served from the main checkout's public folder. A worktree serves
// nothing, so the default points at the real asset folder.
const OUT_DIR = path.resolve(
  valueOf("--out") || path.join(ROOT, "public/assets/lenders")
);

/** @param {{slug:string,name:string,domain:string}} t @param {"missing"|"wrong"} kind */
async function handle(t, kind) {
  const dest = path.join(OUT_DIR, `${t.slug}.png`);
  const site = await readSiteIcons(t.domain);

  if (!site.ok) {
    return { ...t, kind, result: "no_logo", why: `website did not answer (${site.reason})` };
  }

  const owns = siteBelongsToBank(t.name, site, t.domain);
  if (!owns.ok) {
    return { ...t, kind, result: "refused", why: owns.reason, title: site.title };
  }

  for (const url of site.candidates) {
    if (dryRun) {
      return {
        ...t,
        kind,
        result: "would_save",
        confirmed: owns.confirmed,
        why: `would take ${url} (${owns.reason})`,
        title: site.title
      };
    }
    const saved = await saveImage(url, dest);
    if (saved.ok) {
      return {
        ...t,
        kind,
        result: owns.confirmed ? "saved" : "saved_unconfirmed",
        confirmed: owns.confirmed,
        why: `${saved.width}x${saved.height} from ${saved.source}${owns.confirmed ? "" : ` — ${owns.reason}`}`,
        bytes: saved.bytes,
        title: site.title
      };
    }
  }
  return { ...t, kind, result: "no_logo", why: "the website had no picture big enough to use", title: site.title };
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) {
    console.error("Logo folder does not exist:", OUT_DIR);
    process.exit(1);
  }

  /** @type {{slug:string,name:string,domain:string,kind:string}[]} */
  const targets = [];
  if (doMissing) targets.push(...MISSING.map((t) => ({ ...t, kind: "missing" })));
  if (doWrong) targets.push(...WRONG.map((t) => ({ ...t, kind: "wrong" })));

  console.log(
    `${dryRun ? "DRY RUN — " : ""}Looking up ${targets.length} banks. Saving into ${OUT_DIR}\n`
  );

  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    process.stdout.write(`[${i + 1}/${targets.length}] ${t.name} ... `);
    let r;
    try {
      r = await handle(t, t.kind);
    } catch (e) {
      r = { ...t, result: "no_logo", why: `unexpected problem: ${e.message}` };
    }
    results.push(r);
    console.log(`${r.result} — ${r.why}`);
    await sleep(400); // be polite to the bank's website
  }

  const by = (k) => results.filter((r) => r.result === k);
  console.log("\n================ WHAT HAPPENED ================");
  console.log(`Logos saved, confirmed:      ${by("saved").length}`);
  console.log(`Logos saved, needs an eye:   ${by("saved_unconfirmed").length}`);
  console.log(`Refused, would be wrong:     ${by("refused").length}`);
  console.log(`Still no logo:               ${by("no_logo").length}`);
  if (dryRun) console.log(`Would save:                  ${by("would_save").length}`);
  console.log(`Skipped, not a bank:         ${NOT_A_BANK.length} (${NOT_A_BANK.join(", ")})`);

  const sections = [
    ["saved_unconfirmed", "SAVED BUT UNCONFIRMED — a human should glance at these"],
    ["refused", "REFUSED — saving these would have put the wrong company's logo on the bank"],
    ["no_logo", "STILL NO LOGO"]
  ];
  for (const [label, heading] of sections) {
    const list = by(label);
    if (!list.length) continue;
    console.log(`\n--- ${heading} ---`);
    for (const r of list) console.log(`  ${r.name.padEnd(34)} ${r.why}`);
  }

  const reportPath = path.join(OUT_DIR, "..", "..", "..", "logo-run.json");
  if (!dryRun) {
    fs.writeFileSync(
      path.join(__dirname, "last-run.json"),
      JSON.stringify({ ran_at: new Date().toISOString(), out_dir: OUT_DIR, results }, null, 2)
    );
    console.log(`\nRun detail: ${path.join(__dirname, "last-run.json")}`);
  }
  void reportPath;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

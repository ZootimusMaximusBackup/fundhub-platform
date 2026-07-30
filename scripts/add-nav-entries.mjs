#!/usr/bin/env node
/* One-off sweep: put the four new screens into the sidebar every existing
 * screen carries its own copy of.
 *
 * The suite has no template — each screen holds the whole sidebar inline, which
 * is why adding a screen means touching all of them. This script does that edit
 * the same way in every file rather than by hand, so the nav stays byte-identical
 * across screens (which is what makes it read as one app).
 *
 * Idempotent: a file that already has the entries is left alone.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "app");

/* Marketing is its own group rather than more entries under Setup: paid, organic
   and creative are one surface that a marketer lives in, and burying them under
   Setup would say they are configuration. Hiring is configuration, so it goes to
   Setup beside Staff & Teams — the two are the same subject at different stages. */
const MARKETING_GROUP = [
  '      <div class="navgroup"><button class="navhead">Marketing<span class="chev">▾</span></button><div class="navlist">',
  '        <a class="navitem" href="campaign-manager.html"><span class="ico">◇</span><span class="lbl">Campaigns</span></a>',
  '        <a class="navitem" href="social-studio.html"><span class="ico">◉</span><span class="lbl">Social Studio</span></a>',
  '        <a class="navitem" href="creative-factory.html"><span class="ico">✳</span><span class="lbl">Creative Factory</span></a>',
  "      </div></div>",
];

const HIRING_ITEM =
  '        <a class="navitem" href="hiring.html"><span class="ico">⊕</span><span class="lbl">Hiring</span></a>';

const NEW_SCREENS = [
  "campaign-manager.html",
  "social-studio.html",
  "creative-factory.html",
  "hiring.html",
];

let touched = 0;
const skipped = [];

for (const file of readdirSync(APP).filter((f) => f.endsWith(".html")).sort()) {
  const path = join(APP, file);
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");

  const navLine = (href) =>
    lines.findIndex((l) => l.includes('class="navitem') && l.includes(`href="${href}"`));

  // No sidebar (the /app/ router page, the client portal) — nothing to do.
  if (navLine("automations.html") === -1) { skipped.push(file); continue; }

  if (navLine("social-studio.html") !== -1 && navLine("hiring.html") !== -1) continue;

  // Hiring first: inserting it does not move the Automation group, which sits
  // above it, so the second index stays valid either way — but doing the lower
  // edit first keeps that true no matter how the groups get reordered later.
  const staffAt = navLine("staff-teams.html");
  if (staffAt !== -1 && navLine("hiring.html") === -1) {
    lines.splice(staffAt + 1, 0, HIRING_ITEM);
  }

  if (navLine("social-studio.html") === -1) {
    const autoAt = navLine("automations.html");
    // The group closes on the first "</div></div>" after its last item.
    let closeAt = -1;
    for (let i = autoAt; i < lines.length; i++) {
      if (lines[i].includes("</div></div>")) { closeAt = i; break; }
    }
    if (closeAt === -1) {
      console.error(`${file}: could not find the end of the Automation group`);
      process.exit(1);
    }
    lines.splice(closeAt + 1, 0, ...MARKETING_GROUP);
  }

  let out = lines.join("\n");

  // The screen the sidebar is currently on gets the "on" class, same as the rest.
  if (NEW_SCREENS.includes(file)) {
    out = out.replace(
      new RegExp(`<a class="navitem" href="${file.replace(/[.]/g, "\\.")}"`),
      `<a class="navitem on" href="${file}"`
    );
  }

  writeFileSync(path, out);
  touched++;
}

console.log(`sidebar updated in ${touched} screens; no sidebar in: ${skipped.join(", ") || "none"}`);

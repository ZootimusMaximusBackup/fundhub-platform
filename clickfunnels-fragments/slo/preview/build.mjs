/* Build browser-openable previews of the SLO fragments.
 *
 * The three slo-*.html files are ClickFunnels fragments: no doctype, no <html>,
 * no <body>. A browser will render them, but not inside the DOM shell CF puts
 * around them, so spacing and full-bleed behaviour look wrong.
 *
 * This reuses the existing harness wrapper (../../harness/_shell.js) rather than
 * inventing a second one, so a preview here matches a preview of the live funnel
 * fragments next door.
 *
 * Run:  node clickfunnels-fragments/slo/preview/build.mjs
 * Then open the generated files, or serve them:
 *       node clickfunnels-fragments/harness/static-server.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { wrapFragment } from "../../harness/_shell.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..");

const PAGES = [
  ["slo-01-sales.html", "01-sales.html"],
  ["slo-02-order.html", "02-order.html"],
  ["slo-03-thank-you.html", "03-thank-you.html"],
];

for (const [from, to] of PAGES) {
  writeFileSync(join(here, to), wrapFragment(readFileSync(join(src, from), "utf8")));
  console.log("built", to);
}

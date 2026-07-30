#!/usr/bin/env node
/* Build a single self-contained HTML file containing every screen in public/.
 *
 * The site is a set of static pages that link to each other by filename and
 * share a stylesheet. An artifact host serves one file with no network, so
 * this script does three things per page: inline the local CSS/JS it links,
 * drop the font CDN tags (blocked, and the fallback stack is already set),
 * and hand navigation to the parent frame instead of the browser.
 *
 * Output: dist/fundhub-frontend.html
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");

/* The route table. Order is the order of the shell's nav; the group names are
   the real audiences for these screens, not filesystem folders. */
const GROUPS = [
  {
    name: "Public site",
    note: "What a business owner sees before there is an account.",
    pages: [
      ["index.html", "Home"],
      ["dashboard.html", "Applicant dashboard"],
      ["login.html", "Sign in"],
      ["affiliates/index.html", "Affiliates"],
      ["education/index.html", "Education"],
      ["education/terms/index.html", "Education terms"],
      ["education/privacy/index.html", "Education privacy"],
      ["education/refund/index.html", "Education refunds"],
      ["terms/index.html", "Terms"],
      ["privacy/index.html", "Privacy"],
      ["404.html", "Not found"],
    ],
  },
  {
    name: "Sales floor",
    note: "The screens a closer or setter works out of all day.",
    pages: [
      ["app/closer-dashboard.html", "Closer dashboard"],
      ["app/pipeline.html", "Pipeline"],
      ["app/client-control-panel.html", "Client control panel"],
      ["app/messaging.html", "Messaging"],
      ["app/calendar.html", "Calendar"],
      ["app/documents.html", "Documents"],
    ],
  },
  {
    name: "Operations",
    note: "Oversight, configuration and the money surfaces.",
    pages: [
      ["app/command-center.html", "Command center"],
      ["app/ops-admin.html", "Ops admin"],
      ["app/galaxy.html", "Galaxy"],
      ["app/automations.html", "Automations"],
      ["app/agent-editor.html", "Agent editor"],
      ["app/products-commissions.html", "Products & commissions"],
      ["app/staff-teams.html", "Staff & teams"],
      ["app/content-admin.html", "Content admin"],
      ["app/brand-studio.html", "Brand studio"],
      ["app/inquiry-remover.html", "Inquiry remover"],
      ["app/sample-data.html", "Sample data"],
    ],
  },
  {
    name: "External principals",
    note: "Clients, affiliates and white-label partners — outside the CRM.",
    pages: [
      ["app/client-portal.html", "Client portal"],
      ["app/affiliate.html", "Affiliate portal"],
      ["app/partner-galaxy.html", "Partner galaxy"],
    ],
  },
];

/* Injected into every page. Two jobs: keep in-suite navigation inside the
   shell, and stop links that would leave the frame from doing nothing
   visible. Runs at the end of the document so it sees the finished DOM. */
const BRIDGE = `
<script>
(function(){
  function routeFor(a){
    var raw = a.getAttribute("href");
    if(!raw || raw[0] === "#") return null;
    if(/^(https?:|mailto:|tel:|javascript:)/i.test(raw)) return null;
    return raw;
  }
  document.addEventListener("click", function(e){
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if(!a) return;
    var raw = routeFor(a);
    if(raw === null) return;
    e.preventDefault();
    parent.postMessage({ fh: "navigate", href: raw, from: document.documentElement.dataset.fhRoute || "" }, "*");
  }, true);
  document.addEventListener("submit", function(e){ e.preventDefault(); }, true);
})();
<\/script>
`;

function read(rel) {
  return readFileSync(join(PUBLIC, rel), "utf8");
}

/* Resolve an href written inside `pageRel` against the public/ root. */
function resolveRel(pageRel, href) {
  const dir = dirname(pageRel);
  if (href.startsWith("/")) return href.replace(/^\/+/, "");
  const parts = (dir === "." ? [] : dir.split("/")).concat(href.split("/"));
  const out = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/* shell.js is the auth gate. It reads a session from an API that does not
   exist here and forwards every role somewhere else, so inlining it would
   bounce the viewer out of whatever screen they picked. The sidebars it gates
   are written into the pages themselves, so dropping it shows all of them. */
const SKIP_SCRIPTS = new Set(["app/shell.js"]);

const inlined = new Map(); // rel -> text, so shared assets are read once

function assetText(rel) {
  if (!inlined.has(rel)) inlined.set(rel, read(rel));
  return inlined.get(rel);
}

function bundlePage(rel) {
  let html = read(rel);

  // Font CDN: preconnects and the stylesheet link. Blocked by the artifact
  // CSP; the pages already declare system fallbacks after the family name.
  html = html.replace(
    /[ \t]*<link[^>]+href="https:\/\/fonts\.(googleapis|gstatic)\.com[^"]*"[^>]*>\s*/gi,
    ""
  );

  // Local stylesheets -> <style>
  html = html.replace(
    /[ \t]*<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/gi,
    (match, href) => {
      if (/^https?:/i.test(href)) return "";
      const target = resolveRel(rel, href);
      if (!existsSync(join(PUBLIC, target))) return "";
      return `<style data-from="${target}">\n${assetText(target)}\n</style>`;
    }
  );

  // Local scripts -> inline <script>, except the auth gate.
  html = html.replace(
    /[ \t]*<script[^>]*src="([^"]+)"[^>]*><\/script>/gi,
    (match, src) => {
      if (/^https?:/i.test(src)) return "";
      const target = resolveRel(rel, src);
      if (SKIP_SCRIPTS.has(target)) return `<!-- ${target} omitted: auth gate -->`;
      if (!existsSync(join(PUBLIC, target))) return "";
      return `<script data-from="${target}">\n${assetText(target)}\n</script>`;
    }
  );

  html = html.replace(/<html/i, `<html data-fh-route="${rel}"`);

  if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${BRIDGE}</body>`);
  else html += BRIDGE;

  return html;
}

const pages = {};
const missing = [];
for (const group of GROUPS) {
  for (const [rel] of group.pages) {
    if (!existsSync(join(PUBLIC, rel))) { missing.push(rel); continue; }
    pages[rel] = bundlePage(rel);
  }
}
if (missing.length) {
  console.error("missing pages:", missing.join(", "));
  process.exit(1);
}

const nav = GROUPS.map((g) => ({
  name: g.name,
  note: g.note,
  pages: g.pages.map(([rel, label]) => ({ rel, label })),
}));

/* `<` is escaped so no `</script>` inside a page can close the data block. */
const json = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

const shell = readFileSync(join(ROOT, "scripts", "artifact-shell.html"), "utf8")
  // Function replacements: the page JSON is full of `$` sequences ($&, $', $`)
  // that a string replacement would interpret as capture-group references.
  .replace("/*__NAV__*/null", () => json(nav))
  .replace("/*__PAGES__*/null", () => json(pages));

mkdirSync(join(ROOT, "dist"), { recursive: true });
const out = join(ROOT, "dist", "fundhub-frontend.html");
writeFileSync(out, shell);

const kb = (Buffer.byteLength(shell) / 1024).toFixed(0);
console.log(`${Object.keys(pages).length} screens -> ${out} (${kb} KB)`);

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
    name: "Marketing",
    note: "Paid, organic and the creative that feeds both.",
    pages: [
      ["app/campaign-manager.html", "Campaigns"],
      ["app/social-studio.html", "Social studio"],
      ["app/creative-factory.html", "Creative factory"],
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
      ["app/hiring.html", "Hiring"],
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

/* Injected into every page. It makes a framed page behave like a served one:
   links navigate the suite instead of dead-ending, sign-in forwards to the
   CRM, and the shell's own keys still work while focus is inside the frame.
   Runs at the end of the document so it sees the finished DOM. */
const BRIDGE = (rel) => `
<style>
/* Role-based nav visibility. Affiliates see affiliate+client. Clients see client only.
   Partners see partner+client. Public pages have no sidebar. Staff sees all. */
[data-role="affiliate"] .navitem[href*="campaign"],
[data-role="affiliate"] .navitem[href*="social"],
[data-role="affiliate"] .navitem[href*="creative"],
[data-role="affiliate"] .navitem[href*="command"],
[data-role="affiliate"] .navitem[href*="ops-admin"],
[data-role="affiliate"] .navitem[href*="galaxy"],
[data-role="affiliate"] .navitem[href*="automations"],
[data-role="affiliate"] .navitem[href*="agent"],
[data-role="affiliate"] .navitem[href*="hiring"],
[data-role="affiliate"] .navitem[href*="products"],
[data-role="affiliate"] .navitem[href*="staff"],
[data-role="affiliate"] .navitem[href*="content"],
[data-role="affiliate"] .navitem[href*="brand"],
[data-role="affiliate"] .navitem[href*="inquiry"],
[data-role="affiliate"] .navitem[href*="sample"],
[data-role="affiliate"] .navitem[href*="closer"],
[data-role="affiliate"] .navitem[href*="pipeline"],
[data-role="affiliate"] .navitem[href*="client-control"],
[data-role="affiliate"] .navitem[href*="messaging"],
[data-role="affiliate"] .navitem[href*="calendar"],
[data-role="affiliate"] .navitem[href*="documents"],
[data-role="affiliate"] .navgroup{display:none}

[data-role="client"] .navitem[href!="client-portal.html"],
[data-role="client"] .navgroup{display:none}

[data-role="partner"] .navitem[href*="campaign"],
[data-role="partner"] .navitem[href*="social"],
[data-role="partner"] .navitem[href*="creative"],
[data-role="partner"] .navitem[href*="command"],
[data-role="partner"] .navitem[href*="ops-admin"],
[data-role="partner"] .navitem[href*="galaxy:not([href*='partner'])"],
[data-role="partner"] .navitem[href*="automations"],
[data-role="partner"] .navitem[href*="agent"],
[data-role="partner"] .navitem[href*="hiring"],
[data-role="partner"] .navitem[href*="products"],
[data-role="partner"] .navitem[href*="staff"],
[data-role="partner"] .navitem[href*="content"],
[data-role="partner"] .navitem[href*="brand"],
[data-role="partner"] .navitem[href*="inquiry"],
[data-role="partner"] .navitem[href*="sample"],
[data-role="partner"] .navitem[href*="closer"],
[data-role="partner"] .navitem[href*="pipeline"],
[data-role="partner"] .navitem[href*="client-control"],
[data-role="partner"] .navitem[href*="messaging"],
[data-role="partner"] .navitem[href*="calendar"],
[data-role="partner"] .navitem[href*="documents"],
[data-role="partner"] .navgroup{display:none}
</style>
<script>
(function(){
  var ROUTE = ${JSON.stringify(rel)};
  function send(msg){ msg.from = ROUTE; parent.postMessage(msg, "*"); }

  document.addEventListener("click", function(e){
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if(!a) return;
    var href = a.getAttribute("href");
    // In-page anchors scroll natively; off-site links are left to the browser.
    if(!href || href.charAt(0) === "#") return;
    if(/^(https?:|mailto:|tel:|javascript:)/i.test(href)) return;
    e.preventDefault();
    send({ fh: "navigate", href: href });
  }, true);

  document.addEventListener("submit", function(e){
    // The sign-in form is the one submit that means something: the served page
    // posts to /api/auth/login and forwards to /app/. Stop propagation so that
    // handler never runs and never shows a failure the viewer can't act on.
    if(ROUTE === "login.html"){
      e.preventDefault(); e.stopPropagation();
      send({ fh: "signin" });
      return;
    }
    e.preventDefault();
  }, true);

  // "/" opens the screen list and Esc closes it, wherever focus happens to be.
  document.addEventListener("keydown", function(e){
    var t = e.target;
    if(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if(t && t.isContentEditable) return;
    if(e.key !== "/" && e.key !== "Escape" && !(e.altKey && e.key === "ArrowLeft")) return;
    send({ fh: "keydown", event: { key: e.key, altKey: e.altKey } });
  });
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

/* Role-based sidebar visibility. Maps page routes to the role that sees them.
   Staff sees all pages; clients/affiliates/partners see only their allowed screens. */
const ROLE_MAP = {
  // External principals
  "app/affiliate.html": "affiliate",
  "app/client-portal.html": ["affiliate", "client", "partner", "staff"],
  "app/partner-galaxy.html": "partner",
  // Public
  "index.html": "public",
  "dashboard.html": "public",
  "login.html": "public",
  "affiliates/index.html": "public",
  "education/index.html": "public",
  "education/terms/index.html": "public",
  "education/privacy/index.html": "public",
  "education/refund/index.html": "public",
  "terms/index.html": "public",
  "privacy/index.html": "public",
  "404.html": "public",
  // Everything else is staff
};

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

  const role = ROLE_MAP[rel] || "staff";
  const roleAttr = typeof role === "string" ? role : role[0];
  html = html.replace(/<html/i, `<html data-fh-route="${rel}" data-role="${roleAttr}"`);

  const bridge = BRIDGE(rel);
  if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, () => `${bridge}</body>`);
  else html += bridge;

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

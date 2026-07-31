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
<script>
(function(){
  var ROUTE = ${JSON.stringify(rel)};
  function send(msg){ msg.from = ROUTE; parent.postMessage(msg, "*"); }

  /* RBAC: single source of truth mirrored from src/lib/rbac.ts. The shell
     stamps the CURRENT viewer's role onto <html data-role> right before it
     hands this document to the iframe (see render() in artifact-shell.html) —
     this is never the page's own "owner" role, it's whoever is looking.
     Items a role can't reach are removed from the DOM outright, not hidden:
     view-source shows the same thing the eye does. */
  var ROLE_ROUTES = {
    admin: ["app/closer-dashboard.html","app/pipeline.html","app/client-control-panel.html","app/messaging.html","app/calendar.html","app/documents.html","app/campaign-manager.html","app/social-studio.html","app/creative-factory.html","app/command-center.html","app/ops-admin.html","app/galaxy.html","app/automations.html","app/agent-editor.html","app/hiring.html","app/products-commissions.html","app/staff-teams.html","app/content-admin.html","app/brand-studio.html","app/inquiry-remover.html","app/sample-data.html","app/client-portal.html","app/partner-galaxy.html","app/affiliate.html"],
    staff: ["app/closer-dashboard.html","app/pipeline.html","app/client-control-panel.html","app/messaging.html","app/calendar.html","app/documents.html","app/campaign-manager.html","app/social-studio.html","app/creative-factory.html","app/command-center.html","app/galaxy.html","app/automations.html","app/agent-editor.html","app/hiring.html","app/staff-teams.html","app/content-admin.html","app/brand-studio.html","app/inquiry-remover.html","app/sample-data.html","app/client-portal.html"],
    partner: ["app/partner-galaxy.html","app/affiliate.html","app/client-portal.html","app/brand-studio.html","app/campaign-manager.html"],
    affiliate: ["app/affiliate.html","app/client-portal.html"],
    client: ["app/client-portal.html"]
  };

  function resolveHref(pageRel, href){
    href = href.split("#")[0].split("?")[0];
    if(!href) return pageRel;
    var dir = pageRel.indexOf("/") === -1 ? [] : pageRel.split("/").slice(0, -1);
    var parts = href.charAt(0) === "/" ? href.replace(/^\\/+/, "").split("/") : dir.concat(href.split("/"));
    var out = [];
    parts.forEach(function(p){ if(p === "" || p === ".") return; if(p === "..") out.pop(); else out.push(p); });
    return out.join("/");
  }

  function applyRoleFilter(){
    var role = document.documentElement.getAttribute("data-role") || "staff";
    if(role === "admin") return;
    var allowed = ROLE_ROUTES[role] || [];
    var items = document.querySelectorAll(".navitem[href]");
    for(var i=0;i<items.length;i++){
      var full = resolveHref(ROUTE, items[i].getAttribute("href"));
      if(allowed.indexOf(full) === -1) items[i].parentNode.removeChild(items[i]);
    }
    var groups = document.querySelectorAll(".navgroup");
    for(var j=0;j<groups.length;j++){
      if(!groups[j].querySelector(".navitem")) groups[j].parentNode.removeChild(groups[j]);
    }
  }
  applyRoleFilter();

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

  // data-role is a placeholder: the shell overwrites it with the CURRENT
  // viewer's role right before every render() call, never a fixed value baked
  // at build time (see artifact-shell.html). "staff" here is dead as soon as
  // the page is ever framed.
  html = html.replace(/<html/i, `<html data-fh-route="${rel}" data-role="staff"`);

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

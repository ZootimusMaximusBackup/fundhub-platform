/* Bundle the real /app screens into one self-contained page.
 *
 * The artifact host serves a single file and blocks every outbound request, so
 * the twenty screens, the shell, the data layer and the brand tokens all have
 * to travel together. Nothing here rewrites a screen: each one is stored
 * verbatim and written into an about:blank iframe at view time, which is the
 * only way its own inline scripts still run and its own <style> stays scoped
 * to it. The three asset tags become placeholders so the shell, the data layer
 * and the stylesheet are stored once instead of twenty times.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "app");
// Do not publish this onto fundhub.ai. public/crm.html is a live redirect.
const OUT = join(APP, "..", "..", "docs", "artifacts", "crm-offline-bundle.html");

// Sidebar order, then the two screens the sidebar does not link to.
const SCREENS = [
  ["command-center.html", "Command Center"],
  ["pipeline.html", "Pipeline"],
  ["client-control-panel.html", "Client Control Panel"],
  ["messaging.html", "Messaging"],
  ["calendar.html", "Calendar"],
  ["documents.html", "Documents"],
  ["closer-dashboard.html", "Closer Dashboard"],
  ["inquiry-remover.html", "Inquiry Remover"],
  ["ops-admin.html", "Ops & Admin"],
  ["galaxy.html", "Galaxy"],
  ["agent-editor.html", "Agent Editor"],
  ["automations.html", "Workflows"],
  ["products-commissions.html", "Products & Commissions"],
  ["staff-teams.html", "Staff & Teams"],
  ["brand-studio.html", "Brand Studio"],
  ["content-admin.html", "Content"],
  ["sample-data.html", "Sample Data"],
  ["affiliate.html", "Affiliate"],
  ["client-portal.html", "Client Portal"],
  ["partner-galaxy.html", "Partner Galaxy"],
];

const read = (f) => readFileSync(join(APP, f), "utf8");

// A screen is stored inside <script type="text/plain">, so any </script> in its
// own markup would close the wrapper early.
const store = (s) => s.replace(/<\/script/gi, "<\\/script");

const CSS = read("fundhub-brand.css");
const DATA = read("data.js");

/* shell.js names the current screen from the URL, and inside the bundle there
   is no URL to name it with: every screen is written into the same frame. Left
   alone, the role gate reads a page it does not recognise and sends the frame
   to /app/command-center.html — a path that does not exist on the artifact
   host. The one line that reads the URL now prefers a value the prelude sets,
   so the gate, the active-tab highlight and the routing all still run, on the
   screen actually being shown. */
const PAGE_LINE = 'var PAGE = location.pathname.split("/").pop();';
const SHELL = read("shell.js").replace(
  PAGE_LINE,
  'var PAGE = window.__FH_PAGE || location.pathname.split("/").pop();'
);
if (SHELL.includes(PAGE_LINE)) throw new Error("shell.js PAGE line did not patch — check it still reads " + PAGE_LINE);

/* The demo session the app already supports: /login.html writes exactly these
   three keys, getSession() falls back to them when /api/auth/session cannot be
   reached, and FHData.get() short-circuits every read to source:"demo" so each
   screen paints its built-in sample markup and says so in its own banner. No
   API is stubbed and no number is faked — the app reports what it is doing. */
const SESSION = JSON.stringify({
  id: 1,
  name: "Demo Owner",
  email: "owner@fundhub.ai",
  role: "owner",
  employee_code: "EMP-000001",
});

const prelude = (screen) => `<script>
(function () {
  window.__FH_PAGE = ${JSON.stringify(screen)};
  try {
    localStorage.setItem("fh_demo", "1");
    localStorage.setItem("fh_demo_staff", ${JSON.stringify(SESSION)});
    localStorage.setItem("fh_role", "owner");
  } catch (e) {}

  /* Capture phase on the document, registered before shell.js registers its
     own: stopPropagation here means neither the shell's link gate nor the
     sign-out button's handler ever runs, so no click can navigate this frame
     off the only document it will ever have. */
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var t = e.target;
    var el = t && t.closest ? t : (t && t.parentElement);
    if (!el || !el.closest) return;
    if (el.closest("#fh-shell-out")) { e.preventDefault(); e.stopPropagation(); return; }
    var a = el.closest("a[href]");
    if (!a || a.target === "_blank") return;
    var h = (a.getAttribute("href") || "").replace(/^\\.\\//, "").replace(/^\\/app\\//, "");
    var base = h.split("?")[0].split("#")[0];
    if (!/\\.html$/.test(base)) return;
    e.preventDefault();
    e.stopPropagation();
    parent.postMessage({ fhGo: base }, "*");
  }, true);
})();
<\/script>`;

/* The artifact host blocks every outbound request, so a Google Fonts <link> is
   a guaranteed console error and a guaranteed silent fallback. Drop the tags
   and let the font stacks in fundhub-brand.css do their job — but never one
   with an id: brand-studio.html swaps its preview typeface by writing to
   #fontLink, and removing that element turns the swap into a TypeError. */
const stripFonts = (s) =>
  s.replace(/[ \t]*<link (?![^>]*\bid=)[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\n?/g, "");

function bodyOf(file) {
  const src = stripFonts(read(file));
  const out = src
    .replace('<link rel="stylesheet" href="fundhub-brand.css">', "{{CSS}}")
    .replace(/<script(?:\s+defer)?\s+src="shell\.js"><\/script>/, prelude(file) + "{{SHELL}}")
    .replace(/<script(?:\s+defer)?\s+src="data\.js"><\/script>/, "{{DATA}}");
  // A screen whose asset tags do not match is a screen that would load blank.
  if (!out.includes("{{CSS}}") || !out.includes("{{SHELL}}")) {
    throw new Error(file + ": brand stylesheet or shell script tag not found");
  }
  if (src.includes('src="data.js"') && !out.includes("{{DATA}}")) {
    throw new Error(file + ": data.js tag not found");
  }
  return out;
}

const panes = SCREENS.map(
  ([file, name]) =>
    `<script type="text/plain" data-screen="${file}" data-name="${name}">\n${store(bodyOf(file))}\n<\/script>`
).join("\n");

const RUNTIME = `
var UNSTORE = function (s) { return s.split("<\\\\/script").join("<" + "/script"); };
var TAG = function (t, s) { return "<" + t + ">" + s + "<" + "/" + t + ">"; };

var CSS = UNSTORE(document.getElementById("fh-css").textContent);
var SHELL = UNSTORE(document.getElementById("fh-shell").textContent);
var DATA = UNSTORE(document.getElementById("fh-data").textContent);

var SCREENS = {};
[].forEach.call(document.querySelectorAll("script[data-screen]"), function (s) {
  SCREENS[s.getAttribute("data-screen")] = UNSTORE(s.textContent);
});

var HOME = "command-center.html";
var frame = document.getElementById("fh");

/* String.replace with a literal pattern would interpret $& and friends inside
   the shell source, so every substitution goes through a function. */
function put(html, token, text) {
  return html.replace(token, function () { return text; });
}

function show(name) {
  if (!SCREENS[name]) return;
  var html = SCREENS[name];
  html = put(html, "{{CSS}}", TAG("style", CSS));
  html = put(html, "{{SHELL}}", TAG("script", SHELL));
  html = put(html, "{{DATA}}", TAG("script", DATA));
  var d = frame.contentDocument;
  d.open();
  d.write(html);
  d.close();
  if (location.hash.slice(1) !== name) history.replaceState(null, "", "#" + name);
}

addEventListener("message", function (e) {
  if (e.data && e.data.fhGo) show(e.data.fhGo);
});
addEventListener("hashchange", function () { show(location.hash.slice(1) || HOME); });

show(SCREENS[location.hash.slice(1)] ? location.hash.slice(1) : HOME);
`;

/* The charset is load-bearing, not boilerplate: a document.write() frame takes
   its encoding from the parent document, ignoring the screen's own meta, so
   without this every em dash in twenty screens renders as mojibake. */
const page = `<meta charset="utf-8">
<title>Fundhub CRM</title>
<style>
  html, body { margin: 0; height: 100%; background: #0A0A0B; }
  #fh { border: 0; width: 100%; height: 100vh; display: block; background: #FCFCFC; }
</style>
<iframe id="fh" title="Fundhub CRM"></iframe>

<script type="text/plain" id="fh-css">
${store(CSS)}
<\/script>
<script type="text/plain" id="fh-shell">
${store(SHELL)}
<\/script>
<script type="text/plain" id="fh-data">
${store(DATA)}
<\/script>
${panes}

<script>
${RUNTIME}
<\/script>
`;

mkdirSync(join(OUT, ".."), { recursive: true });
writeFileSync(OUT, page);
console.log("wrote", OUT, (page.length / 1024).toFixed(0) + " KB,", SCREENS.length, "screens");

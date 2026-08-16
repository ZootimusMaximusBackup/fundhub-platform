// public/crm.html must never paint the old sample office or set fh_demo.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CRM = path.resolve(HERE, "../../public/crm.html");

test("crm.html sends people to /app/ and does not turn demo on", () => {
  const html = fs.readFileSync(CRM, "utf8");
  assert.ok(html.includes('location.replace("/app/")'), "must send the browser to /app/");
  assert.ok(html.includes('removeItem("fh_demo")'), "must unstick a leftover demo flag");
  assert.ok(!/setItem\(\s*["']fh_demo["']/.test(html), "must not turn demo mode on");
  assert.ok(!/Bianca Souza|Dana Reyes|Derek Owusu/.test(html), "must not ship sample people");
});

const APP = path.resolve(HERE, "../../public/app");
const SAMPLE_PEOPLE = /Dana Reyes|Derek Owusu|Marcus Webb|voided check/i;

test("client control panel and closer cockpit ship no sample people", () => {
  for (const file of ["client-control-panel.html", "closer-call.html"]) {
    const html = fs.readFileSync(path.join(APP, file), "utf8");
    assert.ok(!SAMPLE_PEOPLE.test(html), file + " still has sample furniture");
  }
});

test("client-portal.html ships no sample people and no fake upload or video", () => {
  const html = fs.readFileSync(path.join(APP, "client-portal.html"), "utf8");
  assert.ok(!/Derek Owusu/.test(html), "must not ship Derek Owusu");
  assert.ok(!/Marcus Webb/.test(html), "must not ship Marcus Webb");
  assert.ok(!/setInterval/.test(html), "must not fake progress with setInterval");
  assert.ok(!/var DUR = 252/.test(html), "must not fake a 4:12 welcome video");
  assert.ok(!/markSentUi\(\s*\)/.test(html), "must not mark files sent with no upload");
  assert.ok(html.includes("Open this from a client file"), "empty state must tell them to open from a client file");
  assert.ok(html.includes("Welcome video is not available"));
  assert.ok(html.includes("Uploads are off"));
  assert.ok(html.includes("FHData.client("), "must read GET /api/dashboard/client");
  assert.ok(html.includes('FHData.param("client_id")'), "must accept ?client_id=");
  assert.ok(html.includes("FHData.uploadFiles"), "real upload stays on FHData.uploadFiles");
  assert.ok(html.includes("FHData.entitlements"), "must keep the portal entitlements read");
  assert.ok(html.includes("FHData.documents"), "docs must come from the existing documents read");
});

test("client-control-panel.html binds the live URL client and does not fake a pull", () => {
  const html = fs.readFileSync(path.join(APP, "client-control-panel.html"), "utf8");
  assert.ok(html.includes("FHData.client(id)"), "must read GET /api/dashboard/client");
  assert.ok(html.includes("open_blockers"));
  assert.ok(html.includes("income_estimates"));
  assert.ok(html.includes("funding_rounds"));
  assert.ok(html.includes("employee_next_action"));
  assert.ok(!/data-act/.test(html), "must not keep simulated action buttons");
  assert.ok(!/dataset\.fail/.test(html), "must not pretend a bureau pull failed");
  assert.ok(!/Funding Round #2/.test(html));
  assert.ok(!/Pull Equifax/.test(html));
});

test("sales-floor.html does not ship a hardcoded manager name or fake cash", () => {
  const html = fs.readFileSync(path.join(APP, "sales-floor.html"), "utf8");
  assert.ok(!/Sarah Whitfield/.test(html), "manager chip must not be hardcoded");
  assert.ok(!/\$74,200/.test(html), "hero cash must not be sample dollars");
  assert.ok(!/Bianca Souza/.test(html), "cold-deals sample must not ship");
  assert.ok(!/\$54k/.test(html), "funnel leak copy must not invent success fees");
});

test("closer-call Join stays off until a meeting link exists", () => {
  const html = fs.readFileSync(path.join(APP, "closer-call.html"), "utf8");
  const js = fs.readFileSync(path.join(APP, "closer-call.js"), "utf8");
  assert.ok(html.includes('id="fh-join"'));
  assert.ok(html.includes("disabled"));
  assert.ok(js.includes("join_url"));
  assert.ok(!/JSON\.stringify\(credit\.scores\)/.test(js));
});

test("app clocks are not frozen on Jul 26", () => {
  const files = [
    "command-center.html",
    "inquiry-remover.html",
    "messaging.html",
    "pipeline.html",
    "ops-admin.html",
    "automations.html",
    "galaxy.html",
    "partner-galaxy.html",
  ];
  const CLOCK_MARKUP = /<div[^>]*class="clock"[^>]*>[\s\S]*?<\/div>/gi;
  for (const file of files) {
    const html = fs.readFileSync(path.join(APP, file), "utf8");
    const clocks = html.match(CLOCK_MARKUP) || [];
    assert.ok(clocks.length > 0, file + " has no .clock");
    for (const clock of clocks) {
      assert.ok(!/Jul 26/.test(clock), file + " clock markup still says Jul 26: " + clock);
    }
    assert.ok(
      /timeZone:\s*["']America\/New_York["']/.test(html),
      file + " does not tick in America/New_York"
    );
    assert.ok(
      !/new Date\(\s*2026\s*,\s*6\s*,\s*26/.test(html),
      file + " still seeds a Jul 26 epoch"
    );
  }
});

test("my-numbers.html does not ship sample people or fake cash", () => {
  const html = fs.readFileSync(path.join(APP, "my-numbers.html"), "utf8");
  assert.ok(!/Marcus Webb|Elena Voss|Devon Marsh|Bianca Souza/.test(html));
  assert.ok(!/\$34,000/.test(html));
  assert.ok(html.includes('id="staffChip"'));
});

test("closer-dashboard.html is not Jordan/Priya furniture", () => {
  const html = fs.readFileSync(path.join(APP, "closer-dashboard.html"), "utf8");
  assert.ok(!/Jordan Blake/.test(html));
  assert.ok(!/Priya Nair/.test(html));
  assert.ok(!/>Sun Jul 26/.test(html));
  assert.ok(html.includes("Open from a client"));
  assert.ok(/timeZone:\s*["']America\/New_York["']/.test(html));
});

test("ops, affiliate, and partner galaxy do not ship sample people as live", () => {
  const ops = fs.readFileSync(path.join(APP, "ops-admin.html"), "utf8");
  assert.ok(!/Jordan Blake|Nina Castellano|Marcus Webb/.test(ops));
  assert.ok(ops.includes("No staff rows"));
  assert.ok(ops.includes("FHData.staff"), "ops-admin must bind live staff");
  const aff = fs.readFileSync(path.join(APP, "affiliate.html"), "utf8");
  assert.ok(!/DKOWAL-000123/.test(aff));
  assert.ok(aff.includes("No code yet"));
  assert.ok(aff.includes("No referrals on file"));
  const gal = fs.readFileSync(path.join(APP, "partner-galaxy.html"), "utf8");
  assert.ok(!/Derek Owusu|Priya Nair/.test(gal));
  assert.ok(/var CLIENTS = \[\]/.test(gal));
  assert.ok(/var NODES = \[\]/.test(gal));
  assert.ok(gal.includes("No partners on file"));
  const ae = fs.readFileSync(path.join(APP, "agent-editor.html"), "utf8");
  assert.ok(!/Jordan Blake|Nina Castellano|Marcus Webb/.test(ae));
  assert.ok(ae.includes("Pick a person"));
  assert.ok(ae.includes("FHData.staff"), "agent-editor must load live staff");
  const pc = fs.readFileSync(path.join(APP, "products-commissions.html"), "utf8");
  assert.ok(!/Jordan Blake|Marcus Webb/.test(pc));
  assert.ok(pc.includes("var LEDGER=[]"));
  assert.ok(pc.includes("no commission rows yet"));
});

test("documents.html does not seed sample people before the live read", () => {
  const html = fs.readFileSync(path.join(APP, "documents.html"), "utf8");
  assert.ok(!/Priya Nair|Ray Pulaski/.test(html));
  assert.ok(/var DOCS=\[\]/.test(html));
});

test("client-control-panel right column is paper, not a black gutter", () => {
  const html = fs.readFileSync(path.join(APP, "client-control-panel.html"), "utf8");
  assert.ok(html.includes(".side-col{background:var(--paper)"));
});

test("data.js empty reads do not keep sample markup", () => {
  const js = fs.readFileSync(path.resolve(HERE, "../../public/app/data.js"), "utf8");
  assert.ok(!/showing sample markup/.test(js));
  assert.ok(js.includes("in the database yet"));
});

test("staff-teams.html does not seed Alvin or other fake people", () => {
  const html = fs.readFileSync(path.join(APP, "staff-teams.html"), "utf8");
  assert.ok(/var PEOPLE=\[\]/.test(html));
  assert.ok(!/Alvin Torres/.test(html));
  assert.ok(html.includes("/api/auth/invite"));
  assert.ok(html.includes("/api/auth/suspend"));
});

test("inquiry-remover.html is not Alvin furniture", () => {
  const html = fs.readFileSync(path.join(APP, "inquiry-remover.html"), "utf8");
  assert.ok(!/Alvin Torres/.test(html), "must not ship Alvin Torres");
  assert.ok(!/Wei Chen|Theresa Lindqvist|Felix Ndiaye|Grace Kowalski/.test(html));
  assert.ok(!/93%/.test(html), "must not ship a fake pace");
  assert.ok(!/Equifax is down/.test(html));
  assert.ok(html.includes('id="whoName"'));
  assert.ok(html.includes("/api/auth/session"));
  assert.ok(html.includes("No letters issued yet"));
});

test("closer-call.js does not paint builder notes", () => {
  const js = fs.readFileSync(path.join(APP, "closer-call.js"), "utf8");
  assert.ok(!/staff_targets on My numbers/.test(js));
  assert.ok(!/no conservative band field/.test(js));
  assert.ok(!/numbered field on this payload/.test(js));
  assert.ok(!/Use \/api\/read/.test(js));
});

test("calendar, template-editor, and hiring do not ship furniture names", () => {
  const FURNITURE = /Jordan Blake|Marcus Webb|Nina Torres|Carlos Bettencourt|Meredith Yao/;
  for (const file of ["calendar.html", "template-editor.html", "hiring.html"]) {
    const html = fs.readFileSync(path.join(APP, file), "utf8");
    assert.ok(!FURNITURE.test(html), file + " still has furniture names");
  }
});

test("campaign-manager.html does not ship Dana Reyes furniture", () => {
  const html = fs.readFileSync(path.join(APP, "campaign-manager.html"), "utf8");
  assert.ok(!/Dana Reyes/.test(html), "campaign-manager still has Dana Reyes");
});

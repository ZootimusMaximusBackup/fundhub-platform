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

test("client control panel and merged closer dashboard ship no sample people", () => {
  for (const file of ["client-control-panel.html", "closer-dashboard.html"]) {
    const html = fs.readFileSync(path.join(APP, file), "utf8");
    assert.ok(!SAMPLE_PEOPLE.test(html), file + " still has sample furniture");
  }
});

test("client-portal.html ships no sample people and no fake upload or video", () => {
  const html = fs.readFileSync(path.join(APP, "client-portal.html"), "utf8");
  assert.ok(!/Derek Owusu/.test(html), "must not ship Derek Owusu");
  assert.ok(!/Marcus Webb/.test(html), "must not ship Marcus Webb");
  assert.ok(!/\$46,500/.test(html), "must not ship sample funding dollars");
  assert.ok(!/sample-history/.test(html), "must not keep sample-history furniture");
  assert.ok(!/Jul 24, 2026 · PDF/.test(html), "must not ship sample document dates");
  assert.ok(!/setInterval/.test(html), "must not fake progress with setInterval");
  assert.ok(!/var DUR = 252/.test(html), "must not fake a 4:12 welcome video");
  assert.ok(!/markSentUi\(\s*\)/.test(html), "must not mark files sent with no upload");
  assert.ok(html.includes("Open this from a client file"), "empty state must tell them to open from a client file");
  assert.ok(html.includes("No activity recorded on this file yet"));
  assert.ok(html.includes("Welcome video is not available"));
  assert.ok(html.includes("Uploads are off"));
  assert.ok(html.includes("FHData.client("), "must read GET /api/dashboard/client");
  assert.ok(html.includes('FHData.param("client_id")'), "must accept ?client_id=");
  assert.ok(html.includes("FHData.uploadFiles"), "real upload stays on FHData.uploadFiles");
  assert.ok(html.includes("FHData.entitlements"), "must keep the portal entitlements read");
  assert.ok(html.includes("FHData.portalSummary"), "docs must come from the client-safe portal summary");
  assert.ok(!html.includes("FHData.documents"), "client portal must not call the staff documents read");
});

test("client-portal offer tiles hide list prices except the fixed $32 soft pull", () => {
  const html = fs.readFileSync(path.join(APP, "client-portal.html"), "utf8");
  assert.match(html, /data-tile="SOFT_PULL"[\s\S]*?<div class="tp">\$32<\/div>/);
  assert.match(html, /data-tile="FUNDING_DFY"[\s\S]*?<div class="tp">On your call<\/div>/);
  assert.match(html, /data-tile="REPAIR_DFY"[\s\S]*?<div class="tp">On your call<\/div>/);
  assert.match(html, /data-tile="REPAIR_TRIAL"[\s\S]*?<div class="tp">On your call<\/div>/);
  assert.match(html, /data-tile="UWIQ_DELIVERABLES"[\s\S]*?<div class="tp">On your call<\/div>/);
  assert.match(html, /data-tile="FUNDING_MASTERY"[\s\S]*?<div class="tp">On your call<\/div>/);
  assert.match(html, /class="promo-price">On your call/);
  assert.ok(!html.includes('price:\'$3,000\''), "must not ship funding list price in PRODUCTS");
  assert.ok(!html.includes('price:\'$1,000\''), "must not ship repair list price in PRODUCTS");
  assert.ok(!html.includes('price:\'$200\''), "must not ship trial list price in PRODUCTS");
  assert.ok(!html.includes('price:\'$5,000\''), "must not ship mastery list price in PRODUCTS");
  assert.ok(!html.includes('price:\'$1,000+\''), "must not ship deliverables list price in PRODUCTS");
  assert.ok(!/\$3,000/.test(html), "must not show $3,000 on the client portal");
  assert.ok(!/\$5,000/.test(html), "must not show $5,000 on the client portal");
  assert.ok(!/\$1,000\+?/.test(html), "must not show $1,000 list prices on the client portal");
  assert.ok(!/\$200\b/.test(html), "must not show $200 on the client portal");
  assert.ok(html.includes("price:'$32'"), "soft pull $32 stays visible");
});

test("lenders.html with a client uses the match list, not the whole book", () => {
  const html = fs.readFileSync(path.join(APP, "lenders.html"), "utf8");
  assert.ok(html.includes("scopedClientId"), "must read client_id from the URL");
  assert.ok(html.includes("/api/read/lender-matches"), "open-client desk must load matches");
  assert.ok(
    /if \(scopedClientId\)[\s\S]*\/api\/read\/lender-matches/.test(html),
    "client-open load must call lender-matches, not only the full book"
  );
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
  assert.ok(/Pull TransUnion/.test(html), "must show the TransUnion pull");
  assert.ok(/Pull Experian/.test(html), "must show the Experian pull");
  assert.ok(/Pull Equifax/.test(html), "must show the Equifax pull");
  assert.ok(/Generate Apps/.test(html), "must show Generate Apps");
  assert.ok(html.includes("/api/finance/crs-pull"), "bureau pulls must call the real CRS run endpoint");
  assert.match(html, /fetch\("\/api\/finance\/crs-pull"/);
  assert.match(html, /JSON\.stringify\(\{ client_id: id, bureau: spec\.bureau \}\)/);
  assert.ok(!/JSON\.stringify\(\{[^}]*simulate/.test(html), "CCP must not send simulate on a staff pull");
  assert.ok(html.includes("/api/read/lender-matches"), "Generate Apps must refresh the live lender match list");
  assert.ok(html.includes("/api/applications"), "Bank yes/no must stamp a play on the existing applications door");
  /* RE-POINTED 2026-08-30, same requirement. The apply list still reads the
     saved plays and amounts back onto the rows; the URL moved from a raw fetch
     in the page to FHData.applications() in the data layer. That was not
     tidying: the count of approvals still waiting on a dollar amount now leads
     this screen, and a raw fetch cannot tell "we looked and nothing is waiting"
     from "we could not look" — both arrive as no rows. get() classifies the
     failure so the headline can say "could not check" instead of showing an
     all-clear it never established. */
  assert.ok(html.includes("FHData.applications("),
    "Apply list must read saved plays and amounts back onto the row");
  assert.ok(fs.readFileSync(path.join(APP, "data.js"), "utf8").includes("/api/applications?client_id="),
    "FHData.applications must still be the applications read for one client");
  assert.ok(html.includes("Play name (optional)"), "staff can type or pick a play");
  assert.ok(
    html.includes("Apply shows the client email, not a Fundhub address"),
    "Apply door must tell staff to use the client email, not Fundhub"
  );
});

test("sales-floor.html does not ship a hardcoded manager name or fake cash", () => {
  const html = fs.readFileSync(path.join(APP, "sales-floor.html"), "utf8");
  assert.ok(!/Sarah Whitfield/.test(html), "manager chip must not be hardcoded");
  assert.ok(!/\$74,200/.test(html), "hero cash must not be sample dollars");
  assert.ok(!/Bianca Souza/.test(html), "cold-deals sample must not ship");
  assert.ok(!/\$54k/.test(html), "funnel leak copy must not invent success fees");
});

test("Closer Dashboard Join stays off until a meeting link exists", () => {
  const html = fs.readFileSync(path.join(APP, "closer-dashboard.html"), "utf8");
  const js = fs.readFileSync(path.join(APP, "closer-call.js"), "utf8");
  assert.ok(html.includes('id="fh-join"'));
  assert.ok(html.includes("disabled"));
  assert.ok(js.includes("join_url"));
  assert.ok(!/JSON\.stringify\(credit\.scores\)/.test(js));
});

test("old closer-call URL preserves its full query when it redirects", () => {
  const html = fs.readFileSync(path.join(APP, "closer-call.html"), "utf8");
  assert.match(html, /closer-dashboard\.html"\s*\+\s*location\.search\s*\+\s*location\.hash/);
  assert.ok(!html.includes('src="shell.js"'), "the redirect stub must run before the app shell");
});

test("app clocks are not frozen on Jul 26", () => {
  const files = [
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
      /timeZone:\s*["']America\/Phoenix["']/.test(html),
      file + " does not tick in America/Phoenix"
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
  assert.ok(!/\$500 per deposit/.test(html), "must not invent a commission formula");
  assert.ok(html.includes('id="staffChip"'));
  assert.ok(html.includes("Commission plan comes from the ledger"));
});

test("closer-dashboard.html is not Jordan/Priya furniture", () => {
  const html = fs.readFileSync(path.join(APP, "closer-dashboard.html"), "utf8");
  assert.ok(!/Jordan Blake/.test(html));
  assert.ok(!/Priya Nair/.test(html));
  assert.ok(!/>Sun Jul 26/.test(html));
  assert.ok(!/showing sample markup/.test(html));
  assert.ok(html.includes("Open from a client"));
  assert.ok(html.includes("funding numbers stay dashes") || html.includes("not sourced yet"));
  assert.ok(/timeZone:\s*["']America\/Phoenix["']/.test(html));
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
  assert.ok(!/ND\.jordan|ND\.marcus|ND\.nina/.test(gal), "money flares must not hardcode sample node ids");
  assert.ok(/var CLIENTS = \[\]/.test(gal));
  assert.ok(/var NODES = \[\]/.test(gal));
  assert.ok(gal.includes("No partners on file"));
  const ae = fs.readFileSync(path.join(APP, "agent-editor.html"), "utf8");
  assert.ok(!/Jordan Blake|Nina Castellano|Marcus Webb/.test(ae));
  assert.ok(ae.includes("Pick a person"));
  assert.ok(ae.includes("FHData.staff"), "agent-editor must load live staff");
  assert.ok(ae.includes("id=\"drillCard\""), "closer drill runs on this screen");
  assert.ok(ae.includes("action:'run'"), "drill talks to the existing agents write route");
  assert.ok(ae.includes("rememberSaved"), "Revert must keep the last saved prompt");
  assert.ok(/SAVED\[cur\.id\]/.test(ae), "Revert must restore the last saved prompt");
  const pc = fs.readFileSync(path.join(APP, "products-commissions.html"), "utf8");
  assert.ok(!/Jordan Blake|Marcus Webb|Alvin/.test(pc));
  assert.ok(/var PRODUCTS\s*=\s*\[\s*\]/.test(pc), "products must start empty");
  assert.ok(/var RULES\s*=\s*\[\s*\]/.test(pc), "rules must start empty");
  assert.ok(pc.includes("var LEDGER=[]"));
  assert.ok(pc.includes("no commission rows yet"));
  assert.ok(pc.includes("/api/commission-rules"), "commission edits must persist through the effective-dated rules API");
  assert.ok(!pc.includes("stay in this browser only"), "commission edits must not pretend to save only in the browser");
});

test("documents.html does not seed sample people before the live read", () => {
  const html = fs.readFileSync(path.join(APP, "documents.html"), "utf8");
  assert.ok(!/Priya Nair|Ray Pulaski/.test(html));
  assert.ok(/var DOCS=\[\]/.test(html));
  assert.ok(html.includes("No documents on file yet"));
});

test("galaxy.html does not seed sample standing workers", () => {
  const html = fs.readFileSync(path.join(APP, "galaxy.html"), "utf8");
  assert.ok(/var STANDING = \[\]/.test(html));
  assert.ok(!/\['marcus','dc'\]/.test(html));
  assert.ok(!/Jordan Blake|Marcus Webb|Nina Torres/.test(html));
});

test("Galaxy rails do not paint Alt-Fin (Lendflow)", () => {
  for (const file of ["galaxy.html", "partner-galaxy.html"]) {
    const html = fs.readFileSync(path.join(APP, file), "utf8");
    assert.ok(!/name:'Alt-Fin \(Lendflow\)'/.test(html),
      file + " still labels an Alt-Fin (Lendflow) rail");
    assert.ok(/name:'Card Stacking'/.test(html),
      file + " must still show Card Stacking");
  }
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
  assert.ok(html.includes("/api/auth/staff-role"));
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
  assert.ok(html.includes("Upload FTC or police report"), "FTC upload must stay on the case row");
  assert.ok(html.includes('data-act="upload-fraud"'), "FTC attach action must stay");
  assert.ok(html.includes('data-act="send"'), "Send on a case must stay");
});

test("closer-call.js paints UnderwriteIQ dollars from the real report keys", () => {
  const js = fs.readFileSync(path.join(APP, "closer-call.js"), "utf8");
  assert.match(js, /lite_banner_funding/);
  assert.match(js, /total_personal_funding/);
  assert.match(js, /total_combined_funding/);
  assert.ok(!/d\.projections\s*&&\s*d\.projections\.conservative/.test(js),
    "old projections.conservative paint path would always dash");
});

test("closer-call.js does not paint builder notes", () => {
  const js = fs.readFileSync(path.join(APP, "closer-call.js"), "utf8");
  assert.ok(!/staff_targets on My numbers/.test(js));
  assert.ok(!/no conservative band field/.test(js));
  assert.ok(!/numbered field on this payload/.test(js));
  assert.ok(!/Use \/api\/read/.test(js));
});

test("calendar.html clock and Then rail use America/Phoenix and skip past due_at", () => {
  const html = fs.readFileSync(path.join(APP, "calendar.html"), "utf8");
  assert.ok(/timeZone:\s*["']America\/Phoenix["']/.test(html), "calendar clock must pin America/Phoenix");
  assert.ok(/timeZoneName:\s*["']short["']/.test(html), "calendar clock must label MST");
  assert.ok(/getTime\(\)\s*>\s*nowMs/.test(html), "Then rail and dated-later must filter after now");
});

test("calendar and hiring do not ship furniture names", () => {
  const FURNITURE = /Jordan Blake|Marcus Webb|Nina Torres|Carlos Bettencourt|Meredith Yao/;
  for (const file of ["calendar.html", "hiring.html"]) {
    const html = fs.readFileSync(path.join(APP, file), "utf8");
    assert.ok(!FURNITURE.test(html), file + " still has furniture names");
  }
});

test("campaign-manager.html does not ship Dana Reyes furniture", () => {
  const html = fs.readFileSync(path.join(APP, "campaign-manager.html"), "utf8");
  assert.ok(!/Dana Reyes/.test(html), "campaign-manager still has Dana Reyes");
});

test("honest-ui leftovers screens stay empty without inventing dollars", () => {
  const FURNITURE = /Jordan Blake|Marcus Webb|Nina Torres|Carlos Bettencourt|Meredith Yao|Dana Reyes/;
  for (const file of [
    "closer-dashboard.html",
    "my-numbers.html",
    "client-portal.html",
    "documents.html",
    "products-commissions.html",
    "galaxy.html",
    "partner-galaxy.html",
  ]) {
    const html = fs.readFileSync(path.join(APP, file), "utf8");
    assert.ok(!FURNITURE.test(html), file + " still has furniture names");
  }
});

/* ───────────────────────────────────────────────────────────────────────────
   ARIZONA TIME (owner-set 2026-08-28)

   The CRM ran on America/New_York everywhere. Arizona is where the work
   happens, so every clock, every timestamp and the quiet-hours window moved to
   America/Phoenix. Two things are worth a test rather than a comment: that
   nothing crept back to Eastern, and that a screen cannot ship a topbar with no
   clock in it — which is how pipeline.html came to show no time at all on a
   laptop.
   ─────────────────────────────────────────────────────────────────────────── */

const APP_PAGES = fs.readdirSync(APP).filter((f) => f.endsWith(".html"));

test("every clock and timestamp on a staff screen is Arizona — no exceptions", () => {
  /* This started as "no America/New_York" and that was too narrow. Sweeping
     only for Eastern left four timestamps behind on screens nobody thought to
     check: pipeline's fmtWhen and two on inquiry-remover were America/
     Los_Angeles, and messaging's shortWhen was UTC.

     Pacific is the same clock as Arizona all summer, so those three would have
     looked correct until November and then quietly run an hour behind every
     other clock on the same page. UTC was worse and was wrong already — a
     message sent at 6pm Arizona is tomorrow in UTC, so the one line whose job
     is saying WHICH DAY a message arrived was a day late every evening.

     So the rule is now positive rather than a blocklist: name any zone other
     than Phoenix on a staff screen and this fails. A blocklist only ever stops
     the zone somebody already thought of. If a screen ever genuinely needs to
     show a customer's own local time, add it to ALLOWED with a comment saying
     whose clock it is and why. */
  const ALLOWED = new Set(["America/Phoenix"]);

  for (const file of [...APP_PAGES, "shell.js", "data.js"]) {
    const full = path.join(APP, file);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, "utf8");

    // Named zones ("America/Denver") and the bare ones Intl also accepts ("UTC").
    const named = [...src.matchAll(/timeZone:\s*["']([^"']+)["']/g)].map((m) => m[1]);
    for (const zone of named) {
      assert.ok(
        ALLOWED.has(zone),
        `${file} formats a time in ${zone}. Staff screens are Arizona ` +
        `(America/Phoenix) — see docs/workflows/arizona-time-2026-08-28.md.`
      );
    }
  }
});

test("the shell mounts a clock, in Arizona, on screens that have no clock of their own", () => {
  const shell = fs.readFileSync(path.join(APP, "shell.js"), "utf8");
  assert.match(shell, /var CLOCK_TZ = "America\/Phoenix"/, "the shell clock must be Arizona");
  assert.match(shell, /function mountClock\(/, "the shell must define mountClock");
  assert.match(shell, /mountClock\(role\);/, "mountClock must actually be called on boot");
  // It must not paint over a clock the page already drives, or two writers
  // fight over one element every second.
  assert.match(shell, /if \(document\.querySelector\("\.clock, #clock"\)\) return;/,
    "the shell must leave a page's own clock alone");
  // And it must not put an office clock on the client's own screen.
  assert.match(shell, /if \(role === "client"\) return;/,
    "the client portal must not get a staff clock");
});

test("a page's own media query can no longer hide the clock at laptop width", () => {
  const shell = fs.readFileSync(path.join(APP, "shell.js"), "utf8");
  // The un-hide rule and the one width it still allows a clock to disappear at.
  assert.match(shell, /display:inline-block!important;/,
    "the shell must override the per-page display:none");
  assert.match(shell, /@media \(max-width:900px\)/,
    "the clock may only be hidden below 900px");
  assert.ok(
    !/max-width:1[0-9]{3}px\)\{\.clock/.test(shell),
    "nothing may hide the clock at laptop width again"
  );
});

test("every staff screen with a top bar ends up with a clock in it", () => {
  const NOT_STAFF = new Set(["client-portal.html", "consent-capture.html"]);
  for (const file of APP_PAGES) {
    if (NOT_STAFF.has(file)) continue;
    const html = fs.readFileSync(path.join(APP, file), "utf8");
    if (!/class="[^"]*\btopbar\b/.test(html)) continue;
    const ownClock = /class="[^"]*\bclock\b|id="clock"/.test(html);
    assert.ok(
      ownClock || html.includes("shell.js"),
      file + " has a top bar but neither its own clock nor shell.js to mount one"
    );
  }
});

test("quiet hours on the messaging screen match the server, in Arizona words", () => {
  const html = fs.readFileSync(path.join(APP, "messaging.html"), "utf8");
  assert.match(html, /var QUIET_TZ = "America\/Phoenix"/);
  assert.match(html, /var QUIET_START_HOUR = 20;/);
  assert.match(html, /var QUIET_END_HOUR = 8;/);
  assert.ok(!/Eastern/.test(html), "the texting-hours copy still says Eastern");
});

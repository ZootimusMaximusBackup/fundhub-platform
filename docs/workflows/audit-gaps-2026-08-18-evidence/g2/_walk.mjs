/**
 * G2 live walk — admin, setter, inquiry. Read-only evidence.
 * Does not hire / reject / reset / revoke / invite / save staff.
 * Does not send inquiry, contract, or text. Does not confirm a bureau answer.
 * Never opens client 9af65808-a619-4e65-ae91-239766a006b7.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-gaps-2026-08-18-evidence/g2");
const BASE = "https://fundhub.ai";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

const PASSWORD = process.env.STAFF_E2E_PASSWORD || "";
if (!PASSWORD) throw new Error("STAFF_E2E_PASSWORD missing");

fs.mkdirSync(OUT, { recursive: true });

function chromeExe() {
  const home = process.env.HOME || "";
  const root = path.join(home, "Library/Caches/ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

function ignoreUrl(url) {
  return /fonts\.googleapis|fonts\.gstatic|googletagmanager|google-analytics|hotjar|sentry\.io|favicon|w3\.org/i.test(url);
}

const ROLES = [
  { key: "admin", email: "admin@fundhub.ai" },
  { key: "setter", email: "setter@fundhub.ai" },
  { key: "inquiry", email: "inquiry@fundhub.ai" }
];

const FULL_SCREENS = [
  { label: "Home", href: "partner-galaxy.html" },
  { label: "Pipeline", href: "pipeline.html" },
  { label: "Closer Dashboard", href: "closer-dashboard.html" },
  { label: "Call cockpit", href: "closer-call.html" },
  { label: "My numbers", href: "my-numbers.html" },
  { label: "Sales floor", href: "sales-floor.html" },
  { label: "Calendar", href: "calendar.html" },
  { label: "Lenders", href: "lenders.html" },
  { label: "Finance OS", href: "finance-os.html" },
  { label: "Client Control Panel", href: "client-control-panel.html" },
  { label: "Messaging", href: "messaging.html" },
  { label: "Documents", href: "documents.html" },
  { label: "Specialist", href: "inquiry-remover.html" },
  { label: "Company Brain", href: "company-brain.html" },
  { label: "Galaxy", href: "galaxy.html" },
  { label: "Ops & Admin", href: "ops-admin.html" },
  { label: "Agent Editor", href: "agent-editor.html" },
  { label: "Workflows", href: "automations.html" },
  { label: "Journeys", href: "journeys.html" },
  { label: "Message Copy", href: "template-editor.html" },
  { label: "Campaigns", href: "campaign-manager.html" },
  { label: "Social Studio", href: "social-studio.html" },
  { label: "Creative Factory", href: "creative-factory.html" },
  { label: "Staff & Teams", href: "staff-teams.html" },
  { label: "Hiring", href: "hiring.html" },
  { label: "Products & Commissions", href: "products-commissions.html" },
  { label: "Contract templates", href: "contracts.html" },
  { label: "Brand Studio", href: "brand-studio.html" },
  { label: "Client Portal", href: "client-portal.html" },
  { label: "Affiliate", href: "affiliate.html" },
  { label: "Present", href: "present.html" }
];

const EXTRA_TYPED = [
  { label: "Client Portal as a client", href: "/portal-login.html", kind: "abs" }
];

function attachWatchers(page, bag) {
  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "error" && type !== "warning") return;
    const text = msg.text() || "";
    if (/Download the React DevTools|Third-party cookie|net::ERR_BLOCKED_BY_CLIENT/i.test(text)) return;
    bag.console.push({ type, text: text.slice(0, 400) });
  });
  page.on("pageerror", (err) => {
    bag.pageErrors.push(String(err && err.message ? err.message : err).slice(0, 400));
  });
  page.on("response", (res) => {
    const url = res.url();
    if (ignoreUrl(url)) return;
    const status = res.status();
    let pathOnly = url;
    try {
      const u = new URL(url);
      pathOnly = (u.pathname + u.search).slice(0, 240);
    } catch { /* keep url */ }
    if (status >= 400) bag.net.push({ status, url: pathOnly, method: res.request().method() });
    if (/\/api\/read\/inquiry-cases/.test(url) && status < 400) {
      res.json().then((d) => {
        bag.inquiryCases = ((d && d.cases) || []).map((c) => ({
          case_id: c.id || c.case_id || null,
          client_id: c.client_id || null,
          isTest: c.client_id === TEST_CLIENT,
          isForbidden: c.client_id === FORBIDDEN
        }));
      }).catch(() => {});
    }
    if (/\/api\/read\/repair-cases/.test(url) && !/[?&]client_id=/.test(url) && status < 400) {
      res.json().then((d) => {
        const files = (d && (d.files || d.cases || d.rows)) || [];
        bag.repairFiles = files.map((f) => ({
          client_id: f.client_id || null,
          isTest: f.client_id === TEST_CLIENT,
          isForbidden: f.client_id === FORBIDDEN
        }));
      }).catch(() => {});
    }
  });
}

async function login(page, email) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator("#email").fill(email);
  await page.locator("#pw").fill(PASSWORD);
  await page.locator("#go").click();
  await page.waitForFunction(() => !/login\.html|portal-login\.html/i.test(location.pathname), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return { ok: true };
}

async function facts(page) {
  return page.evaluate(() => {
    const body = (document.body && document.body.innerText) || "";
    const nav = [...document.querySelectorAll("#fh-side-nav a")].filter((a) => a.offsetParent).map((a) => ({
      label: (a.querySelector(".lbl")?.textContent || a.textContent || "").replace(/\s+/g, " ").trim(),
      href: (a.getAttribute("href") || "").split("?")[0]
    })).filter((x) => x.label);
    const specialistRow = nav.find((n) => /specialist/i.test(n.label));
    return {
      url: location.href,
      pathname: location.pathname,
      title: document.title,
      h1: (document.querySelector("h1, .page-title, .hdr h1, .topbar h1, .sub")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160),
      snippet: body.replace(/\s+/g, " ").slice(0, 700),
      visibleNav: nav,
      specialistNav: specialistRow || null,
      roleChip: (document.querySelector(".who, #fh-role-chip, .org-pill, #whoRole")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 120)
    };
  });
}

function abortIfForbidden(url) {
  if (String(url).includes(FORBIDDEN)) {
    throw new Error("refused: forbidden client id in URL");
  }
}

async function shot(page, slug, full = false) {
  abortIfForbidden(page.url());
  const file = path.join(OUT, `${slug}.png`);
  await page.screenshot({ path: file, fullPage: full });
  return path.relative(ROOT, file);
}

function targetName(hrefOrPath) {
  const p = String(hrefOrPath || "").split("?")[0];
  const leaf = p.split("/").pop();
  return leaf || p;
}

function openedAgainst(landedPath, targetHref) {
  const landed = targetName(landedPath);
  const want = targetName(targetHref);
  return landed === want;
}

const report = {
  ranAt: new Date().toISOString(),
  live: BASE,
  forbiddenClient: FORBIDDEN,
  testClient: TEST_CLIENT,
  groundTruth: {
    admin: "MISSING intended file. README role sets: FINANCE, STAFF, OPS, HIRING, LENDERS.",
    setter: "MISSING intended file. README maps setter into STAFF only.",
    inquiry: "docs/journeys/role-inquiry-remover-intended.md specialist desk items 1–7."
  },
  roles: {},
  matrix: [],
  hidden: [],
  desk: null,
  notes: []
};

async function waitSettled(page) {
  await page.waitForTimeout(1400);
  abortIfForbidden(page.url());
}

async function expandAllGroups(page) {
  await page.evaluate(() => {
    document.querySelectorAll(".navgroup.closed").forEach((g) => g.classList.remove("closed"));
  });
  await page.waitForTimeout(250);
}

async function collectExpandedNav(page) {
  await expandAllGroups(page);
  return facts(page);
}

async function walkVisibleNav(page, role) {
  const start = await collectExpandedNav(page);
  report.roles[role.key].visibleNavExpanded = start.visibleNav;
  report.roles[role.key].shotNavExpanded = await shot(page, `${role.key}-00-nav-expanded`);
  const seen = new Set();
  for (const item of start.visibleNav) {
    if (!item.href || seen.has(item.href)) continue;
    seen.add(item.href);
    abortIfForbidden(item.href);
    await page.goto(BASE + "/app/" + item.href, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitSettled(page);
    const f = await facts(page);
    const opened = openedAgainst(f.pathname, item.href);
    const row = {
      role: role.key,
      source: "nav",
      screen: item.label,
      href: item.href,
      opened,
      bounced: !opened,
      landed: targetName(f.pathname),
      h1: f.h1,
      title: f.title,
      snippet: f.snippet.slice(0, 280),
      shot: await shot(page, `${role.key}-nav-${item.href.replace(/\.html$/, "")}`)
    };
    report.matrix.push(row);
    process.stdout.write(`${role.key} NAV ${item.label}: ${opened ? "OPEN" : "BOUNCE→" + row.landed}\n`);
  }
  return seen;
}

async function typeHidden(page, role, visibleHrefs) {
  const probes = FULL_SCREENS
    .filter((s) => !visibleHrefs.has(s.href))
    .map((s) => ({ ...s, kind: "app" }))
    .concat(EXTRA_TYPED);
  for (const probe of probes) {
    const visible = probe.kind === "app" && visibleHrefs.has(probe.href);
    const url = probe.kind === "abs" ? BASE + probe.href : BASE + "/app/" + probe.href;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitSettled(page);
    const f = await facts(page);
    const want = probe.kind === "abs" ? probe.href : probe.href;
    const opened = openedAgainst(f.pathname, want);
    const row = {
      role: role.key,
      source: visible ? "typed-also-in-nav" : "typed-hidden",
      screen: probe.label,
      href: probe.href,
      wasInNav: !!visible,
      opened,
      bounced: !opened,
      landed: targetName(f.pathname),
      h1: f.h1,
      title: f.title,
      snippet: f.snippet.slice(0, 280),
      shot: await shot(page, `${role.key}-typed-${probe.label.replace(/\s+/g, "-").toLowerCase()}`)
    };
    report.hidden.push(row);
    process.stdout.write(`${role.key} TYPE ${probe.label}: ${opened ? "OPEN" : "BOUNCE→" + row.landed} (nav=${visible ? "yes" : "no"})\n`);
  }
}

async function walkInquiryDesk(page, bag) {
  await page.goto(BASE + "/app/inquiry-remover.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(8000);
  abortIfForbidden(page.url());
  const f0 = await facts(page);
  const landedSpecialist = /inquiry-remover\.html$/.test(f0.pathname);

  const deskDom = await page.evaluate(() => {
    const navLabels = [...document.querySelectorAll("#fh-side-nav a")].filter((a) => a.offsetParent).map((a) =>
      (a.querySelector(".lbl")?.textContent || a.textContent || "").replace(/\s+/g, " ").trim()
    );
    const inq = document.getElementById("tab-inquiries");
    const rep = document.getElementById("tab-repair");
    const need = document.querySelector('#inq-stats [data-stat="left"]');
    const caseBody = document.getElementById("caseQueueBody");
    const queueStatus = document.getElementById("queue-status-row");
    const repairBody = document.getElementById("repairBody");
    const stuck = document.getElementById("repair-exceptions");
    const confirmBtns = [...document.querySelectorAll("[data-confirm-parse]")].filter((e) => e.offsetParent);
    return {
      navHasSpecialist: navLabels.some((t) => /^Specialist$/i.test(t)),
      navLabels,
      inquiriesSelected: inq ? inq.getAttribute("aria-selected") === "true" : null,
      repairSelected: rep ? rep.getAttribute("aria-selected") === "true" : null,
      togglePresent: !!(inq && rep && inq.offsetParent && rep.offsetParent),
      needMe: (need && need.textContent || "").trim(),
      needMeVisible: !!(need && need.offsetParent),
      caseQueueText: (caseBody && caseBody.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300),
      caseQueueLoading: /Loading cases/i.test(caseBody && caseBody.innerText || ""),
      workQueueText: (queueStatus && queueStatus.innerText || "").replace(/\s+/g, " ").trim().slice(0, 220),
      workQueueLoading: /Loading inquiry queue/i.test(queueStatus && queueStatus.innerText || ""),
      repairHidden: !!(document.getElementById("pane-repair") && document.getElementById("pane-repair").hidden),
      repairText: (repairBody && repairBody.innerText || "").replace(/\s+/g, " ").trim().slice(0, 220),
      stuckHidden: !!(stuck && stuck.hidden),
      stuckVisible: !!(stuck && !stuck.hidden && stuck.offsetParent),
      confirmBureauVisible: confirmBtns.length > 0,
      whoRole: (document.getElementById("whoRole")?.innerText || "").replace(/\s+/g, " ").trim()
    };
  });

  const desk = {
    landingPath: f0.pathname,
    landedOnSpecialist: landedSpecialist,
    shotLanding: await shot(page, "inquiry-00-landing"),
    shotInquiries: await shot(page, "inquiry-desk-inquiries", true),
    item1_sideMenuSpecialist: deskDom.navHasSpecialist,
    item2_toggle: {
      present: deskDom.togglePresent,
      inquiriesOnFirst: deskDom.inquiriesSelected === true && deskDom.repairSelected === false
    },
    item3_needMe: { visible: deskDom.needMeVisible, value: deskDom.needMe },
    item4_inquiryQueue: {
      caseQueueText: deskDom.caseQueueText,
      caseQueueLoading: deskDom.caseQueueLoading,
      workQueueText: deskDom.workQueueText,
      workQueueLoading: deskDom.workQueueLoading,
      casesFromApi: bag.inquiryCases || []
    },
    whoRole: deskDom.whoRole,
    testCase: null,
    repair: null,
    stuck: { hidden: deskDom.stuckHidden, visible: deskDom.stuckVisible, confirmBureauVisible: deskDom.confirmBureauVisible }
  };

  const testCase = (bag.inquiryCases || []).find((c) => c.isTest);
  const forbiddenListed = (bag.inquiryCases || []).some((c) => c.isForbidden);
  desk.forbiddenListedInQueue = forbiddenListed;
  if (forbiddenListed) desk.notes = ["forbidden client id appeared in API list — not opened"];

  if (testCase) {
    const idx = (bag.inquiryCases || []).findIndex((c) => c.isTest);
    const rows = page.locator("#caseQueueBody tr.case-main");
    const n = await rows.count();
    if (idx >= 0 && idx < n) {
      await rows.nth(idx).click();
      await page.waitForTimeout(1200);
      const sendVisible = await page.evaluate(() => {
        const btns = [...document.querySelectorAll("button, a")].filter((e) => e.offsetParent);
        return btns
          .map((e) => (e.innerText || "").replace(/\s+/g, " ").trim())
          .filter((t) => /^send$/i.test(t) || /send letters/i.test(t) || /send\b/i.test(t))
          .slice(0, 8);
      });
      desk.testCase = {
        opened: true,
        client_id: TEST_CLIENT,
        sendButtonsSeen: sendVisible,
        sendPressed: false,
        shot: await shot(page, "inquiry-desk-test-case", true)
      };
      process.stdout.write("inquiry DESK opened TEST case — Send not pressed\n");
    } else {
      desk.testCase = { opened: false, reason: "test client in API but row index missing", client_id: TEST_CLIENT };
    }
  } else {
    desk.testCase = { opened: false, reason: "test client not listed in inquiry-cases API" };
    process.stdout.write("inquiry DESK no TEST case in queue\n");
  }

  const repairTab = page.locator("#tab-repair");
  if (await repairTab.count()) {
    await repairTab.click();
    await page.waitForTimeout(2500);
  }
  const repairDom = await page.evaluate(() => {
    const body = document.getElementById("repairBody");
    const note = document.getElementById("repairNote");
    const err = document.getElementById("repairErr");
    const stuck = document.getElementById("repair-exceptions");
    const confirmBtns = [...document.querySelectorAll("[data-confirm-parse]")].filter((e) => e.offsetParent);
    const empty = /No repair files yet|The list is empty/i.test(body && body.innerText || "");
    const loading = !!(body && body.querySelector(".sk"));
    return {
      repairSelected: document.getElementById("tab-repair")?.getAttribute("aria-selected") === "true",
      paneHidden: !!(document.getElementById("pane-repair") && document.getElementById("pane-repair").hidden),
      text: (body && body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 280),
      note: (note && note.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160),
      err: (err && !err.hidden && err.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160),
      empty,
      loading,
      needMe: (document.getElementById("repairNeedMe")?.innerText || "").trim(),
      stuckHidden: !!(stuck && stuck.hidden),
      stuckVisible: !!(stuck && !stuck.hidden && stuck.offsetParent),
      stuckText: (stuck && !stuck.hidden && stuck.innerText || "").replace(/\s+/g, " ").trim().slice(0, 220),
      confirmBureauVisible: confirmBtns.length > 0
    };
  });
  desk.repair = {
    ...repairDom,
    filesFromApi: bag.repairFiles || [],
    shot: await shot(page, "inquiry-desk-repair", true)
  };
  desk.stuck = {
    hidden: repairDom.stuckHidden,
    visible: repairDom.stuckVisible,
    text: repairDom.stuckText,
    confirmBureauVisible: repairDom.confirmBureauVisible,
    confirmPressed: false
  };

  const testRepair = (bag.repairFiles || []).find((f) => f.isTest);
  if (testRepair) {
    const opened = await page.evaluate((id) => {
      const tr = document.querySelector(`tr[data-repair-row="${id}"]`);
      if (!tr) return false;
      tr.click();
      return true;
    }, TEST_CLIENT);
    if (opened) {
      await page.waitForTimeout(1200);
      desk.repair.testRowOpened = true;
      desk.repair.testShot = await shot(page, "inquiry-desk-repair-test", true);
      process.stdout.write("inquiry DESK opened TEST repair row — Send letters not pressed\n");
    } else {
      desk.repair.testRowOpened = false;
      desk.repair.testRowReason = "test client in API but no row";
    }
  } else {
    desk.repair.testRowOpened = false;
    desk.repair.testRowReason = "test client not in repair list";
  }

  report.desk = desk;
  return desk;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chromeExe() });
  try {
    for (const role of ROLES) {
      process.stdout.write(`\n=== ${role.key} ${role.email} ===\n`);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const bag = { console: [], pageErrors: [], net: [], inquiryCases: [], repairFiles: [] };
      attachWatchers(page, bag);
      page.on("dialog", async (d) => {
        report.notes.push({ role: role.key, dialog: d.type(), message: String(d.message() || "").slice(0, 200), action: "dismiss" });
        await d.dismiss();
      });
      const loginRes = await login(page, role.email);
      const f = await facts(page);
      report.roles[role.key] = {
        email: role.email,
        login: loginRes,
        landing: { pathname: f.pathname, h1: f.h1, title: f.title, roleChip: f.roleChip },
        visibleNav: f.visibleNav,
        shot: await shot(page, `${role.key}-00-landing`)
      };
      process.stdout.write(`${role.key} landing ${f.pathname} h1=${f.h1}\n`);

      if (role.key === "inquiry") {
        await walkInquiryDesk(page, bag);
      }

      const visibleHrefs = await walkVisibleNav(page, role);
      await typeHidden(page, role, visibleHrefs);

      report.roles[role.key].net4xx = bag.net.slice(0, 40);
      report.roles[role.key].pageErrors = bag.pageErrors.slice(0, 12);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const roles = ["admin", "setter", "inquiry"];
  const screens = [];
  const keyOf = (r) => r.screen + "|" + r.href;
  for (const r of report.matrix.concat(report.hidden)) {
    if (!screens.find((s) => s === r.screen)) screens.push(r.screen);
  }
  const matrixLines = ["| Screen | admin | setter | inquiry |", "|---|---|---|---|"];
  const by = {};
  for (const r of report.matrix.concat(report.hidden)) {
    const k = r.screen;
    by[k] = by[k] || {};
    const mark = r.opened ? "OPEN" : "BOUNCE";
    const prev = by[k][r.role];
    if (!prev) by[k][r.role] = mark;
    else if (prev !== mark) by[k][r.role] = prev + "/" + mark;
  }
  for (const s of screens) {
    const row = by[s] || {};
    matrixLines.push(`| ${s} | ${row.admin || "—"} | ${row.setter || "—"} | ${row.inquiry || "—"} |`);
  }
  fs.writeFileSync(path.join(OUT, "matrix.md"), matrixLines.join("\n") + "\n");
  fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(report, null, 2));
  process.stdout.write("\nWROTE walk.json + matrix.md\n");
})().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});

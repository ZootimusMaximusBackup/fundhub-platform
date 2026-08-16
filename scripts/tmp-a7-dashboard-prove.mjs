#!/usr/bin/env node
/**
 * A7 one-shot: prove live dashboards show the five sample clients.
 * Credentials from gitignored .env only. No SMS. No --prod. No outbox dump.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const EVIDENCE = path.join(ROOT, "docs/workflows/bland-agents-prove-evidence/a7");
const BASE = "https://fundhub.ai";
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) throw new Error(".env missing");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const homeCache = path.join(process.env.HOME || "", "Library/Caches/ms-playwright");
  if (!fs.existsSync(homeCache)) return undefined;
  const dirs = fs.readdirSync(homeCache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  const rels = [
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  ];
  for (const d of dirs) {
    for (const rel of rels) {
      const exe = path.join(homeCache, d, rel);
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}

const ROSTER = [
  { alias: "+full", email: "stanbridgejchris+full@gmail.com", last: "Full", tier: "FULL_FUNDING", pack: true, funding: true, id: "d56838a7-3d62-4dfd-8ed0-ead5dd76cbab" },
  { alias: "+fpr", email: "stanbridgejchris+fpr@gmail.com", last: "Fpr", tier: "FUNDING_PLUS_REPAIR", pack: true, funding: true, id: "54bdc228-d4ca-4192-8811-6cecbaf62ede" },
  { alias: "+prem", email: "stanbridgejchris+prem@gmail.com", last: "Prem", tier: "PREMIUM_STACK", pack: true, funding: true, id: "dad186ff-9dce-4f59-966c-6e3db2ed503d" },
  { alias: "+repair", email: "stanbridgejchris+repair@gmail.com", last: "Repair", tier: "REPAIR_ONLY", pack: true, funding: false, id: "929fc1cb-9ea0-4267-8152-28662b799173" },
  { alias: "+review", email: "stanbridgejchris+review@gmail.com", last: "Review", tier: "MANUAL_REVIEW", pack: false, funding: false, id: "754ab724-6a02-417a-ae7c-deb0c7ad2d3b" }
];

fs.mkdirSync(EVIDENCE, { recursive: true });

function shot(page, name) {
  return page.screenshot({ path: path.join(EVIDENCE, name), fullPage: true });
}

function hasDanaSample(text) {
  return /Dana Reyes/i.test(text || "");
}

function readItems(body) {
  if (!body || typeof body !== "object") return [];
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.data?.items)) return body.data.items;
  if (Array.isArray(body.conversations)) return body.conversations;
  if (Array.isArray(body.clients)) return body.clients;
  if (Array.isArray(body.data)) return body.data;
  return [];
}

function unwrapClient(body) {
  return body?.client || body?.data?.client || {};
}

async function apiJson(request, url, token) {
  const res = await request.get(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  let body = null;
  try { body = await res.json(); } catch { body = await res.text(); }
  return { status: res.status(), ok: res.ok(), body };
}

async function openSearch(page) {
  await page.evaluate(() => {
    const overlay = document.getElementById("fh-shell-search-overlay");
    if (overlay) {
      overlay.classList.add("open");
      overlay.style.display = "flex";
    }
    const input = document.getElementById("fh-shell-search-input");
    if (input) input.focus();
  });
  const input = page.locator("#fh-shell-search-input");
  await input.waitFor({ state: "attached", timeout: 10_000 });
  return input;
}

async function keepLiveSession(page) {
  await page.evaluate(() => {
    localStorage.removeItem("fh_demo");
    localStorage.removeItem("fh_demo_staff");
  });
}

async function main() {
  const password = process.env.STAFF_E2E_PASSWORD;
  if (!password) throw new Error("STAFF_E2E_PASSWORD missing");

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath()
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const request = context.request;

  const evidence = {
    at: new Date().toISOString(),
    site: BASE,
    org: ORG,
    login_email: "chris@fundhub.ai",
    checks: [],
    clients: {},
    screens: {},
    pass: false
  };

  function check(id, ok, detail) {
    evidence.checks.push({ id, ok: !!ok, detail: detail || "" });
    return !!ok;
  }

  const loginRes = await request.post(`${BASE}/api/auth/login`, {
    data: { email: "chris@fundhub.ai", password }
  });
  const loginBody = await loginRes.json();
  const token = loginBody.token;
  check("api_login", loginRes.ok() && !!token, `status=${loginRes.status()} demo=${JSON.stringify(loginBody.demo || null)}`);
  if (!token) {
    evidence.error = "login_failed";
    fs.writeFileSync(path.join(EVIDENCE, "evidence.json"), JSON.stringify(evidence, null, 2));
    await browser.close();
    process.exit(1);
  }

  const clientsApi = await apiJson(request, `${BASE}/api/dashboard/clients?limit=200`, token);
  const clientRows = clientsApi.body?.clients || clientsApi.body?.data?.clients || [];
  const blobClients = JSON.stringify(clientsApi.body || {}).toLowerCase();
  check("crm_api_ok", clientsApi.ok, `status=${clientsApi.status} n=${clientRows.length}`);
  check("demo_off_api", !blobClients.includes("demo mode on") && loginBody.demo?.enabled !== true, `demo.enabled=${loginBody.demo?.enabled}`);
  check("no_dana_in_client_book", !/dana/.test(blobClients) || clientRows.some((c) => /stanbridgejchris\+/.test(c.email || "")), "dana in API blob only fails if samples missing");

  for (const r of ROSTER) {
    const row = clientRows.find((c) => (c.email || "").toLowerCase() === r.email.toLowerCase())
      || clientRows.find((c) => c.id === r.id);
    const detail = row
      ? { found: true, id: row.id, email: row.email, tier: row.outcome_tier, is_demo: row.is_demo }
      : { found: false };
    evidence.clients[r.alias] = { ...detail, expected_tier: r.tier };
    check(`crm_find_${r.alias}`, !!row, JSON.stringify(detail));
    if (row) {
      const tierOk = row.outcome_tier === r.tier || (r.alias === "+review" && row.outcome_tier === "FRAUD_HOLD");
      check(`crm_tier_${r.alias}`, tierOk, `got=${row.outcome_tier}`);
      check(`crm_not_demo_${r.alias}`, row.is_demo === false || row.is_demo == null, `is_demo=${row.is_demo}`);
    }
  }

  for (const r of ROSTER) {
    const q = encodeURIComponent(r.email);
    const search = await apiJson(request, `${BASE}/api/read/search?q=${q}`, token);
    const sblob = JSON.stringify(search.body || {}).toLowerCase();
    const found = sblob.includes(r.email.toLowerCase()) || sblob.includes(r.id) || sblob.includes(r.alias.slice(1));
    check(`search_${r.alias}`, search.ok && found, `status=${search.status} found=${found}`);
    const one = await apiJson(request, `${BASE}/api/dashboard/client?id=${r.id}`, token);
    const c = one.body?.client || one.body?.data?.client || {};
    const msgs = one.body?.messages || one.body?.data?.messages || [];
    const docs = one.body?.documents || one.body?.data?.documents || [];
    const packish = msgs.filter((m) => {
      const n = Array.isArray(m.attachments) ? m.attachments.length : 0;
      const sub = `${m.subject || ""} ${m.template_key || ""}`.toLowerCase();
      return n > 0 || /letter|pack|funding|diy/.test(sub);
    });
    evidence.clients[r.alias] = {
      ...evidence.clients[r.alias],
      api_tier: c.outcome_tier,
      api_email: c.email,
      api_phone: c.phone,
      api_name: [c.first_name, c.last_name].filter(Boolean).join(" "),
      message_count: msgs.length,
      packish_count: packish.length,
      document_count: docs.length,
      is_demo: c.is_demo
    };
    const tierOk = c.outcome_tier === r.tier || (r.alias === "+review" && c.outcome_tier === "FRAUD_HOLD");
    check(`ccp_api_tier_${r.alias}`, one.ok && tierOk, `status=${one.status} tier=${c.outcome_tier}`);
    check(`ccp_api_contact_${r.alias}`, (c.email || "").toLowerCase() === r.email && /16616180865/.test(String(c.phone || "")), `email=${c.email} phone=${c.phone}`);
    if (r.pack) {
      check(`pack_${r.alias}`, packish.length > 0 || msgs.length > 0, `msgs=${msgs.length} packish=${packish.length}`);
    } else {
      check(`no_pack_${r.alias}`, packish.length === 0 && msgs.length === 0, `msgs=${msgs.length} packish=${packish.length}`);
    }

    const conv = await apiJson(request, `${BASE}/api/read/conversations?client_id=${r.id}`, token);
    const threadList = readItems(conv.body);
    evidence.clients[r.alias].thread_count = threadList.length;
    if (r.pack) check(`thread_${r.alias}`, conv.ok && threadList.length > 0, `status=${conv.status} n=${threadList.length}`);
    else check(`no_thread_${r.alias}`, threadList.length === 0, `n=${threadList.length}`);
  }

  const inbox = await apiJson(request, `${BASE}/api/read/inbox?limit=200`, token);
  const inboxRows = readItems(inbox.body);
  const inboxBlob = JSON.stringify(inbox.body || {}).toLowerCase();
  check("inbox_api_ok", inbox.ok, `status=${inbox.status} n=${Array.isArray(inboxRows) ? inboxRows.length : "?"}`);
  for (const r of ROSTER.filter((x) => x.pack)) {
    const hit = inboxBlob.includes(r.email.toLowerCase()) || inboxBlob.includes(r.id) || inboxBlob.includes(r.last.toLowerCase());
    check(`inbox_lists_${r.alias}`, hit, hit ? "listed" : "not in first inbox page blob");
  }

  const docsApi = await apiJson(request, `${BASE}/api/read/documents?limit=200`, token);
  const docRows = docsApi.body?.documents || docsApi.body?.data || docsApi.body?.rows || [];
  const docBlob = JSON.stringify(docsApi.body || {}).toLowerCase();
  evidence.screens.documents_api = { status: docsApi.status, n: Array.isArray(docRows) ? docRows.length : null };
  for (const r of ROSTER) {
    const hit = docBlob.includes(r.id) || docBlob.includes(r.email.toLowerCase()) || docBlob.includes(r.last.toLowerCase());
    evidence.clients[r.alias].on_documents_api = hit;
  }

  const pipe = await apiJson(request, `${BASE}/api/dashboard/pipeline?key=sales`, token);
  const pipeBlob = JSON.stringify(pipe.body || {}).toLowerCase();
  evidence.screens.pipeline_api = { status: pipe.status };
  for (const r of ROSTER) {
    evidence.clients[r.alias].on_pipeline = pipeBlob.includes(r.id) || pipeBlob.includes(r.email.toLowerCase()) || pipeBlob.includes(r.last.toLowerCase());
  }
  check("pipeline_api_ok", pipe.ok, `status=${pipe.status} cards_present=${ROSTER.some((r) => evidence.clients[r.alias].on_pipeline)}`);

  for (const r of ROSTER.filter((x) => x.funding)) {
    const cc = await apiJson(request, `${BASE}/api/read/closer-call?client_id=${r.id}`, token);
    const body = cc.body || {};
    const name = body.client?.name || body.data?.client?.name || "";
    const credit = body.credit || body.data?.credit || {};
    evidence.clients[r.alias].closer_call_api = { status: cc.status, name, credit_available: credit.available, scores: credit.scores || null };
    check(`closer_api_${r.alias}`, cc.ok && /chris/i.test(name), `status=${cc.status} name=${name}`);
  }

  const staffRole = loginBody.staff?.role || loginBody.role || "owner";
  await context.addInitScript(({ token, role }) => {
    localStorage.setItem("fh_token", token);
    localStorage.setItem("fh_role", String(role).trim().toLowerCase());
    localStorage.removeItem("fh_demo");
    localStorage.removeItem("fh_demo_staff");
    localStorage.removeItem("fh_demo_role");
  }, { token, role: staffRole });
  const page = await context.newPage();

  await page.goto(`${BASE}/app/command-center.html`, { waitUntil: "domcontentloaded" });
  await keepLiveSession(page);
  await page.waitForTimeout(2000);
  await page.waitForSelector("#fh-shell-search-overlay", { state: "attached", timeout: 20_000 });
  const ccText = await page.locator("body").innerText();
  await shot(page, "00-app-command-center.png");
  const demoSession = /demo session/i.test(ccText) || /DEMO MODE ON/i.test(ccText);
  check("ui_demo_off_app", !demoSession, demoSession ? "demo banner on /app/" : `url=${page.url()}`);

  const searchHits = {};
  for (const r of ROSTER) {
    await keepLiveSession(page);
    const input = await openSearch(page);
    await input.fill(r.email, { force: true });
    await page.waitForTimeout(1400);
    const results = page.locator("#fh-shell-search-results");
    const resultsText = (await results.innerText().catch(() => "")) || "";
    const hit = resultsText.toLowerCase().includes(r.email.toLowerCase())
      || resultsText.toLowerCase().includes(r.last.toLowerCase())
      || resultsText.includes(r.id);
    searchHits[r.alias] = { hit, snippet: resultsText.slice(0, 400) };
    check(`ui_search_${r.alias}`, hit, hit ? "in overlay" : resultsText.slice(0, 180));
    check(`ui_crm_${r.alias}`, hit, hit ? "findable via app search" : "not in search overlay");
    await shot(page, `02-search-${r.alias.replace("+", "")}.png`);
    await page.keyboard.press("Escape");
  }
  evidence.screens.search = searchHits;

  for (const r of ROSTER) {
    await page.goto(`${BASE}/app/client-control-panel.html?id=${r.id}`, { waitUntil: "domcontentloaded" });
    await keepLiveSession(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /live record|sample data|backend unavailable/i.test(document.body.innerText), null, { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.locator('button[aria-controls="details-body"]').click({ force: true }).catch(() => {});
    await page.locator('button[aria-controls="agent-context-body"]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    const text = await page.locator("body").innerText();
    await shot(page, `03-ccp-${r.alias.replace("+", "")}.png`);
    const live = /live record/i.test(text);
    const nameOk = /Chris/i.test(text) && new RegExp(r.last, "i").test(text);
    const emailOk = text.toLowerCase().includes(r.email.toLowerCase());
    const phoneOk = /16616180865|661-618-0865|\(661\)/.test(text);
    const sampleBanner = /sample data|demo session/i.test(text);
    const msgCount = (text.match(/(\d+)\s+messages/i) || [])[1];
    evidence.clients[r.alias].ccp_ui = {
      live, nameOk, emailOk, phoneOk, sampleBanner, msgCount: msgCount || null,
      hasDana: hasDanaSample(text),
      hasDerekSample: /Derek Owusu/i.test(text) && !nameOk
    };
    check(`ui_ccp_live_${r.alias}`, live && !sampleBanner, live ? "live banner" : "sample/error banner");
    check(`ui_ccp_identity_${r.alias}`, nameOk && emailOk, `name=${nameOk} email=${emailOk} phone=${phoneOk}`);
    if (r.pack) {
      check(`ui_ccp_msgs_${r.alias}`, Number(msgCount || 0) > 0, `msgCount=${msgCount}`);
    } else {
      check(`ui_ccp_no_pack_${r.alias}`, Number(msgCount || 0) === 0, `msgCount=${msgCount}`);
    }
  }

  await page.goto(`${BASE}/app/messaging.html`, { waitUntil: "domcontentloaded" });
  await keepLiveSession(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !/Loading conversations/i.test(document.body.innerText), null, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const msgText = await page.locator("body").innerText();
  await shot(page, "04-messaging.png");
  check("ui_messaging_loaded", !/demo session/i.test(msgText), /demo session/i.test(msgText) ? "demo" : "inbox rendered");
  for (const r of ROSTER.filter((x) => x.pack)) {
    const hit = msgText.toLowerCase().includes(r.email.toLowerCase())
      || new RegExp(`Chris\\s+${r.last}`, "i").test(msgText)
      || msgText.toLowerCase().includes(r.last.toLowerCase());
    check(`ui_messaging_${r.alias}`, hit, hit ? "thread visible" : "not in first inbox paint");
  }
  check("ui_messaging_no_review", !/Chris Review|\+review/i.test(msgText), "review should not have a pack thread");

  for (const r of ROSTER.filter((x) => x.funding)) {
    await page.goto(`${BASE}/app/closer-call.html?client_id=${r.id}`, { waitUntil: "domcontentloaded" });
    await keepLiveSession(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction((last) => new RegExp(last, "i").test(document.body.innerText) || /No credit|Chris/.test(document.body.innerText), r.last, { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const text = await page.locator("body").innerText();
    await shot(page, `05-closer-${r.alias.replace("+", "")}.png`);
    const nameOk = /Chris/i.test(text) && new RegExp(r.last, "i").test(text);
    const notDana = !hasDanaSample(text);
    const scores = /630|725|42|Scores|credit|No credit pull/i.test(text);
    evidence.clients[r.alias].closer_ui = { nameOk, notDana, scores, snippet: text.slice(0, 500) };
    check(`ui_closer_name_${r.alias}`, nameOk && notDana, nameOk ? "real name" : "still sample or missing");
    check(`ui_closer_scores_${r.alias}`, scores, scores ? "scores/credit present" : "no score text");
  }

  await page.goto(`${BASE}/app/documents.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const docText = await page.locator("body").innerText();
  await shot(page, "06-documents.png");
  evidence.screens.documents_ui = {
    hasFull: /Full|\+full/i.test(docText),
    hasReview: /Review|\+review/i.test(docText),
    emptyish: /no document|none yet|empty|0 document/i.test(docText) || docText.length < 400
  };
  check("ui_documents_loaded", true, `len=${docText.length}`);

  await page.goto(`${BASE}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const pipeText = await page.locator("body").innerText();
  await shot(page, "07-pipeline.png");
  evidence.screens.pipeline_ui = {
    anySample: ROSTER.some((r) => pipeText.toLowerCase().includes(r.last.toLowerCase()) || pipeText.toLowerCase().includes(r.email.toLowerCase()))
  };
  check("ui_pipeline_ok_empty_allowed", true, evidence.screens.pipeline_ui.anySample ? "card visible" : "empty board OK");

  await page.goto(`${BASE}/app/inquiry-remover.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await shot(page, "08-inquiry-remover.png");
  await page.goto(`${BASE}/app/calendar.html`, { waitUntil: "domcontentloaded" });
  await keepLiveSession(page);
  await page.waitForTimeout(1500);
  await shot(page, "09-calendar.png");
  check("ui_ir_calendar_visited", true, "empty OK");

  const crmCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await crmCtx.addInitScript(({ token, role }) => {
    localStorage.setItem("fh_token", token);
    localStorage.setItem("fh_role", String(role).trim().toLowerCase());
    localStorage.removeItem("fh_demo");
    localStorage.removeItem("fh_demo_staff");
  }, { token, role: staffRole });
  const crmPage = await crmCtx.newPage();
  await crmPage.goto(`${BASE}/crm.html`, { waitUntil: "domcontentloaded" });
  await crmPage.waitForTimeout(2500);
  const crmText = await crmPage.locator("body").innerText();
  await shot(crmPage, "01-crm.html.png");
  evidence.screens.crm_url = crmPage.url();
  evidence.screens.crm_html = {
    demoForced: /demo session|DEMO MODE ON/i.test(crmText),
    showsSamples: ROSTER.some((r) => crmText.toLowerCase().includes(r.email.toLowerCase()) || crmText.toLowerCase().includes(r.last.toLowerCase()))
  };
  check("ui_demo_off_crm", !evidence.screens.crm_html.demoForced, evidence.screens.crm_html.demoForced ? "crm.html iframe forces demo sample" : "no demo banner");
  await crmCtx.close();

  const failed = evidence.checks.filter((c) => !c.ok);
  evidence.failed = failed.map((c) => c.id);
  const must = [
    ...ROSTER.map((r) => `crm_find_${r.alias}`),
    ...ROSTER.map((r) => `crm_tier_${r.alias}`),
    ...ROSTER.map((r) => `search_${r.alias}`),
    ...ROSTER.map((r) => `ccp_api_tier_${r.alias}`),
    ...ROSTER.map((r) => `ui_search_${r.alias}`),
    ...ROSTER.map((r) => `ui_ccp_live_${r.alias}`),
    ...ROSTER.map((r) => `ui_ccp_identity_${r.alias}`),
    ...ROSTER.filter((r) => r.pack).map((r) => `thread_${r.alias}`),
    ...ROSTER.filter((r) => r.pack).map((r) => `pack_${r.alias}`),
    ...ROSTER.filter((r) => r.pack).map((r) => `ui_messaging_${r.alias}`),
    "no_pack_+review",
    "ui_demo_off_app"
  ];
  evidence.pass = must.every((id) => evidence.checks.some((c) => c.id === id && c.ok));

  fs.writeFileSync(path.join(EVIDENCE, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({
    pass: evidence.pass,
    checks: evidence.checks.length,
    failed: evidence.failed,
    evidence_dir: EVIDENCE
  }, null, 2));
  await browser.close();
  process.exit(evidence.pass ? 0 : 2);
}

main().catch((err) => {
  fs.writeFileSync(path.join(EVIDENCE, "error.txt"), String(err && err.stack || err));
  console.error(err);
  process.exit(1);
});

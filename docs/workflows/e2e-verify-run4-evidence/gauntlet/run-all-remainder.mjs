#!/usr/bin/env node
/** Remainder of full gauntlet. Dry-run stays 1. No secret prints. */
import fs from "fs";
import crypto from "node:crypto";

const BASE = "https://fundhub.ai";
const WATCH = `${BASE}/.netlify/functions/tmp-cf-seam-watch`;
const stamp = Date.now();
const prior = JSON.parse(
  fs.readFileSync(new URL("./run-2026-08-13.json", import.meta.url), "utf8")
);

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i < 0) continue;
    env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env;
}
const env = { ...loadEnv(), ...process.env };
const SECRET = env.DASHBOARD_SECRET;
const PASS = env.STAFF_E2E_PASSWORD;
const COMMAS_SECRET = env.COMMAS_WEBHOOK_SECRET || env.COMMAS_SIGNING_SECRET || env.FANBASIS_WEBHOOK_SECRET || "";

const out = {
  at: new Date().toISOString(),
  prior_client: prior.client_id,
  homepage: {},
  commas: {},
  correlate: {},
  portal: {},
  upload: {},
  hiring: {},
  roles: [],
  pages: [],
  apis: [],
  extra_emits: [],
  scenarios: {},
  stubs: [],
  gaps: []
};

async function login(email, password = PASS) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const j = await r.json().catch(() => ({}));
  const cookie = (r.headers.get("set-cookie") || "")
    .split(/,(?=[^;]+?=)/)
    .map((s) => s.split(";")[0].trim())
    .join("; ");
  return {
    status: r.status,
    ok: j.ok === true,
    kind: j.principal?.kind || j.staff?.role || null,
    headers: {
      cookie,
      authorization: `Bearer ${j.token || ""}`,
      accept: "application/json"
    }
  };
}

async function get(headers, path) {
  const r = await fetch(path.startsWith("http") ? path : BASE + path, { headers });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
}

async function post(headers, path, body) {
  const r = await fetch(path.startsWith("http") ? path : BASE + path, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
}

async function watch(body) {
  const r = await fetch(WATCH, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cf-seam-token": SECRET },
    body: JSON.stringify(body)
  });
  return { http: r.status, ...(await r.json().catch(() => ({}))) };
}

async function emit(email, name, payload, clientId) {
  const res = await watch({
    action: "emit_inngest_probe",
    name,
    email,
    client_id: clientId,
    payload: { email, source: "gauntlet-all", ...payload }
  });
  const row = { name, ok: Boolean(res.ok && res.event_id), inngest: res.inngest_send?.ok === true, error: res.error || null };
  out.extra_emits.push(row);
  console.log("EMIT", name, row.ok ? "PASS" : "FAIL");
  return res;
}

function stageOf(pipe, clientId) {
  for (const s of pipe.stages || []) {
    for (const c of s.cards || []) {
      if (String(c.client_id) === String(clientId)) return s.key;
    }
  }
  return null;
}

const staff = await login("chris@fundhub.ai");
console.log("STAFF", staff.status, staff.ok);

// --- homepage survey ---
const homeEmail = `bakerskater987+test.home.${stamp}@gmail.com`;
const homeBody = {
  name: "Home Gauntlet",
  email: homeEmail,
  phone: "(602) 555-0177",
  source: "website:home",
  sms_consent: true,
  answers: {
    cf_svy_funding_target_amount: "$50k - $100k",
    cf_svy_planned_use: "Growth (marketing, inventory, hiring)",
    cf_svy_money_change_now: "Grow faster (more customers / more reach)",
    cf_svy_self_reported_fico: "650-699",
    cf_svy_has_business: "Yes, 1-2 years",
    cf_svy_business_revenue: "$100k - $249k",
    cf_svy_revenue_verifiable: "Yes, bank statements",
    cf_svy_available_capital: "Less than $1k"
  }
};
const home = await fetch(`${BASE}/api/public/survey-submit`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(homeBody)
});
const homeJ = await home.json().catch(() => ({}));
out.homepage = {
  status: home.status,
  ok: homeJ.ok === true,
  qualification: homeJ.qualification || homeJ.redirect || null,
  error: homeJ.error || null
};
console.log("HOME", out.homepage);
await new Promise((r) => setTimeout(r, 1500));
const homeSearch = await get(staff.headers, `/api/read/search?q=${encodeURIComponent(homeEmail)}`);
out.homepage.client_id = homeSearch.json?.groups?.clients?.[0]?.id || null;
out.homepage.found = Boolean(out.homepage.client_id);
const homePipe = await get(staff.headers, "/api/dashboard/pipeline?pipeline=sales");
out.homepage.stage = stageOf(homePipe.json, out.homepage.client_id);
if (out.homepage.client_id) {
  const ccp = await get(staff.headers, `/api/dashboard/client?id=${out.homepage.client_id}`);
  const cf = ccp.json?.client?.custom_fields || {};
  out.homepage.capital = cf.cf_svy_available_capital;
  out.homepage.svy = Object.keys(cf).filter((k) => k.startsWith("cf_svy_"));
}

// --- commas unsigned (fail closed) + signed if secret present ---
const commasBody = JSON.stringify({
  type: "payment.succeeded",
  data: {
    payment_id: `gauntlet-${stamp}`,
    fan: { email: homeEmail },
    product: { title: "Business Financial Assessment", price: 32 }
  }
});
const unauth = await fetch(`${BASE}/api/webhooks/commas`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: commasBody
});
out.commas.unsigned = { status: unauth.status, ok: unauth.status === 401 };
console.log("COMMAS unsigned", unauth.status);
if (COMMAS_SECRET) {
  const sig = crypto.createHmac("sha256", COMMAS_SECRET).update(commasBody).digest("hex");
  const signed = await fetch(`${BASE}/api/webhooks/commas`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-signature": sig },
    body: commasBody
  });
  const sj = await signed.json().catch(() => ({}));
  out.commas.signed = { status: signed.status, ok: signed.status < 400, error: sj.error || null };
  console.log("COMMAS signed", signed.status, sj.error || "ok");
} else {
  out.commas.signed = { skipped: true, reason: "no local COMMAS webhook secret" };
  out.gaps.push("commas signed webhook skipped — secret not in local .env");
}

// --- correlate prior client ---
const CID = prior.client_id;
const ccp = await get(staff.headers, `/api/dashboard/client?id=${CID}`);
const cl = ccp.json?.client || {};
out.correlate.ccp_ok = Boolean(cl.id);
out.correlate.tags = cl.tags || [];
out.correlate.tasks = (ccp.json?.tasks || []).map((t) => t.title);
out.correlate.messages = (ccp.json?.messages || []).length;
out.correlate.tx = (ccp.json?.transactions || []).length;
out.correlate.inquiry_case = Boolean(ccp.json?.inquiry_removal_case);

const irList = await get(staff.headers, "/api/read/inquiry-cases");
const irRows = irList.json?.cases || irList.json?.rows || irList.json?.items || [];
out.correlate.ir_list_has = Array.isArray(irRows) && irRows.some((r) => String(r.client_id) === CID || String(r.id) === prior.extra?.inquiry?.id);
out.correlate.ir_status = irList.status;

const contracts = await get(staff.headers, `/api/read/contracts?client_id=${CID}`);
out.correlate.contracts_status = contracts.status;
const contractRows = contracts.json?.contracts || contracts.json?.rows || [];
out.correlate.contract_signed = Array.isArray(contractRows) && contractRows.some((r) => r.status === "signed" || r.id === prior.extra?.contract_draft?.id);

const inbox = await get(staff.headers, `/api/read/inbox?clientId=${CID}`);
out.correlate.inbox = { status: inbox.status, ok: inbox.json?.ok === true };

const docs = await get(staff.headers, `/api/read/documents?clientId=${CID}`);
out.correlate.docs = { status: docs.status, ok: docs.json?.ok === true, n: (docs.json?.documents || docs.json?.rows || []).length };

const wf = await get(staff.headers, "/api/read/workflows");
out.correlate.automations = { status: wf.status, ok: wf.json?.ok === true, n: (wf.json?.workflows || wf.json?.runs || wf.json?.items || []).length };

const floor = await get(staff.headers, "/api/read/sales-floor");
out.correlate.floor = { status: floor.status, ok: floor.json?.ok === true };

const nums = await get(staff.headers, "/api/read/my-numbers");
out.correlate.numbers = { status: nums.status, ok: nums.json?.ok === true };

const search = await get(staff.headers, `/api/read/search?q=${encodeURIComponent(prior.email)}`);
out.correlate.search = Boolean(search.json?.groups?.clients?.some((c) => c.id === CID));

// --- documents upload ---
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const form = new FormData();
form.append("client_id", CID);
form.append("subtype", "other");
form.append("file", new Blob([pdf], { type: "application/pdf" }), "gauntlet.pdf");
const up = await fetch(`${BASE}/api/documents-upload`, {
  method: "POST",
  headers: { cookie: staff.headers.cookie, authorization: staff.headers.authorization },
  body: form
});
const upJ = await up.json().catch(() => ({}));
out.upload = { status: up.status, ok: upJ.ok === true, error: upJ.error || null, n: (upJ.documents || upJ.results || []).length };
console.log("UPLOAD", out.upload);

const docs2 = await get(staff.headers, `/api/read/documents?clientId=${CID}`);
out.upload.after = (docs2.json?.documents || docs2.json?.rows || []).length;

// --- hiring ---
const cand = await get(staff.headers, "/api/hiring/candidates");
const posts = await get(staff.headers, "/api/hiring/postings");
out.hiring = {
  candidates: { status: cand.status, ok: cand.status === 200, n: (cand.json?.candidates || cand.json?.rows || []).length },
  postings: { status: posts.status, ok: posts.status === 200 || posts.status === 403, n: (posts.json?.postings || posts.json?.rows || []).length }
};
console.log("HIRING", out.hiring);

// --- remaining pages ---
const extraPages = [
  "/app/closer-call.html",
  "/app/template-editor.html",
  "/app/subscriptions.html",
  "/app/company-brain.html",
  "/app/galaxy.html",
  "/app/ops-admin.html",
  "/app/campaign-manager.html",
  "/app/social-studio.html",
  "/app/creative-factory.html",
  "/app/content-admin.html",
  "/app/brand-studio.html",
  "/app/partner-galaxy.html",
  "/app/sample-data.html",
  "/app/consent-capture.html",
  "/app/client-portal.html",
  "/login.html",
  "/contract.html"
];
for (const p of extraPages) {
  const r = await fetch(BASE + p);
  out.pages.push({ k: p, ok: r.status === 200, status: r.status });
}
console.log("PAGES extra", out.pages.filter((p) => p.ok).length + "/" + out.pages.length);

const extraApis = [
  "/api/read/staff",
  "/api/hiring/funnel",
  "/api/hiring/bench",
  "/api/read/failed-events",
  "/api/org-brand",
  `/api/read/entitlements`
];
for (const p of extraApis) {
  const r = await get(staff.headers, p);
  out.apis.push({ k: p, ok: r.status === 200 || r.status === 403, status: r.status });
}

// --- roles ---
for (const email of [
  "closer@fundhub.ai",
  "advisor@fundhub.ai",
  "inquiry@fundhub.ai",
  "setter@fundhub.ai",
  "sales@fundhub.ai",
  "client@fundhub.ai",
  "affiliate@fundhub.ai",
  "partner@fundhub.ai",
  "jordan@fundhub.ai",
  "nina@fundhub.ai"
]) {
  const l = await login(email);
  out.roles.push({ email, status: l.status, ok: l.ok, kind: l.kind });
  console.log("ROLE", email, l.status, l.ok ? "PASS" : "FAIL");
}

// --- portal isolation ---
const portalEmail = prior.email;
const issue = await watch({ action: "issue_portal_link", email: portalEmail });
out.portal.issue = { ok: issue.ok, limited: issue.limited, has_token: issue.has_token };
if (issue.token) {
  const v = await fetch(`${BASE}/api/auth/magic-link-verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: issue.token })
  });
  const vj = await v.json().catch(() => ({}));
  const cookie = (v.headers.get("set-cookie") || "")
    .split(/,(?=[^;]+?=)/)
    .map((s) => s.split(";")[0].trim())
    .join("; ");
  const ph = { cookie, authorization: `Bearer ${vj.token || ""}`, accept: "application/json" };
  const sess = await get(ph, "/api/auth/session");
  const dash = await get(ph, "/api/dashboard/pipeline?pipeline=sales");
  const ent = await get(ph, "/api/read/entitlements");
  const portalPage = await fetch(`${BASE}/app/client-portal.html`);
  out.portal.verify = { status: v.status, ok: vj.ok === true, next: vj.next };
  out.portal.session = { status: sess.status, kind: sess.json?.principal?.kind || sess.json?.kind };
  out.portal.staff_api_blocked = dash.status === 401 || dash.status === 403;
  out.portal.entitlements = { status: ent.status, ok: ent.status === 200 || ent.status === 403 };
  out.portal.page = portalPage.status;
  console.log("PORTAL", out.portal.verify, "blocked_staff", out.portal.staff_api_blocked);
} else {
  out.gaps.push("portal reissue no token");
}

// --- scenario clients: noshow + decline ---
const nsEmail = `bakerskater987+test.noshow.${stamp}@gmail.com`;
await emit(nsEmail, "entry.captured", { name: "NoShow Gauntlet", phone: "(602) 555-0166" });
await emit(nsEmail, "booking.created", { bookingUid: `ns-${stamp}`, startTime: new Date().toISOString() });
await emit(nsEmail, "booking.noshow", { bookingUid: `ns-${stamp}` });
await new Promise((r) => setTimeout(r, 1200));
const nsSearch = await get(staff.headers, `/api/read/search?q=${encodeURIComponent(nsEmail)}`);
const nsId = nsSearch.json?.groups?.clients?.[0]?.id;
const nsCcp = nsId ? await get(staff.headers, `/api/dashboard/client?id=${nsId}`) : { json: {} };
out.scenarios.noshow = {
  client_id: nsId,
  tags: nsCcp.json?.client?.tags || [],
  has_noshow: (nsCcp.json?.client?.tags || []).some((t) => /no.?show/i.test(t))
};
console.log("NOSHOW", out.scenarios.noshow.has_noshow, out.scenarios.noshow.tags);

const decEmail = `bakerskater987+test.decline.${stamp}@gmail.com`;
await emit(decEmail, "entry.captured", { name: "Decline Gauntlet", phone: "(602) 555-0155" });
await emit(decEmail, "booking.created", { bookingUid: `dec-${stamp}` });
await emit(decEmail, "payment.failed", { productName: "Consulting Services Deposit", amount: 3000, providerRef: `fail-${stamp}` });
await new Promise((r) => setTimeout(r, 800));
const decSearch = await get(staff.headers, `/api/read/search?q=${encodeURIComponent(decEmail)}`);
out.scenarios.decline = { client_id: decSearch.json?.groups?.clients?.[0]?.id, found: Boolean(decSearch.json?.groups?.clients?.[0]) };

// --- more events on prior client ---
for (const [name, payload] of [
  ["booking.rescheduled", { bookingUid: `gauntlet-resched-${stamp}` }],
  ["docs.received", {}],
  ["diy.package.requested", {}],
  ["repair.docs.needed", {}],
  ["invoice.sent", { amount: 3000 }]
]) {
  await emit(prior.email, name, payload, CID);
}

out.summary = {
  homepage: out.homepage.ok && out.homepage.found,
  homepage_stage: out.homepage.stage,
  commas_unsigned_401: out.commas.unsigned?.ok,
  commas_signed: out.commas.signed,
  search: out.correlate.search,
  ir: out.correlate.ir_list_has,
  upload: out.upload.ok,
  hiring_candidates: out.hiring.candidates?.ok,
  extra_pages: `${out.pages.filter((p) => p.ok).length}/${out.pages.length}`,
  roles_ok: out.roles.filter((r) => r.ok).map((r) => r.email),
  roles_fail: out.roles.filter((r) => !r.ok).map((r) => r.email),
  portal_blocked_staff: out.portal.staff_api_blocked,
  noshow_tag: out.scenarios.noshow?.has_noshow,
  extra_emits: `${out.extra_emits.filter((e) => e.ok).length}/${out.extra_emits.length}`,
  gaps: out.gaps
};
console.log("SUMMARY", JSON.stringify(out.summary, null, 2));
fs.writeFileSync(new URL("./run-all-remainder.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");

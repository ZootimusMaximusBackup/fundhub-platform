// Live HTTP probes for G5. No Inngest test events. No real booking. No bank submit.
import fs from "node:fs";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
for (const line of fs.readFileSync(ROOT + "/.env", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 1) continue;
  const k = t.slice(0, i).trim();
  const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const FAKE_LENDER = "00000000-0000-4000-8000-000000000001";

function clipBody(text, n = 800) {
  const s = String(text == null ? "" : text);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function probe(method, path, opts = {}) {
  const url = BASE + path;
  const headers = { ...(opts.headers || {}) };
  const init = { method, headers, redirect: "manual" };
  if (opts.body != null) {
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    if (!headers["content-type"] && !headers["Content-Type"]) {
      headers["content-type"] = "application/json";
    }
  }
  const started = Date.now();
  let res, text;
  try {
    res = await fetch(url, init);
    text = await res.text();
  } catch (err) {
    return {
      method, path, ok: false, error: String(err && err.message ? err.message : err).slice(0, 240),
      ms: Date.now() - started
    };
  }
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return {
    method,
    path,
    status: res.status,
    ok: res.ok,
    contentType: res.headers.get("content-type"),
    ms: Date.now() - started,
    body: json || clipBody(text),
    bodyPreview: clipBody(text, 400)
  };
}

const out = { at: new Date().toISOString(), probes: {} };

out.probes.inngestGet = await probe("GET", "/api/inngest");
out.probes.inngestHead = await probe("HEAD", "/api/inngest");

out.probes.calcomForged = await probe("POST", "/api/webhooks/calcom", {
  headers: {
    "content-type": "application/json",
    "x-cal-signature-256": "deadbeef"
  },
  body: { triggerEvent: "BOOKING_CREATED", payload: { uid: "g5-forged-do-not-book" } }
});
out.probes.calShort = await probe("POST", "/api/webhooks/cal", {
  headers: { "content-type": "application/json" },
  body: { triggerEvent: "BOOKING_CREATED" }
});

const password = process.env.STAFF_E2E_PASSWORD;
if (!password) {
  out.login = { ok: false, error: "STAFF_E2E_PASSWORD missing" };
} else {
  const login = await probe("POST", "/api/auth/login", {
    body: { email: "chris@fundhub.ai", password }
  });
  out.login = {
    status: login.status,
    ok: Boolean(login.body && login.body.ok),
    error: login.body && login.body.error ? login.body.error : null,
    hasToken: Boolean(login.body && login.body.token)
  };
  const token = login.body && login.body.token;
  if (token) {
    const auth = { authorization: "Bearer " + token, accept: "application/json" };
    out.probes.workflows = await probe("GET", "/api/read/workflows", { headers: auth });
    if (out.probes.workflows.body && typeof out.probes.workflows.body === "object") {
      const b = out.probes.workflows.body;
      out.workflowsSummary = {
        engine_active: b.engine_active,
        n: Array.isArray(b.workflows) ? b.workflows.length : (Array.isArray(b.rows) ? b.rows.length : null),
        keys: Object.keys(b)
      };
    }
    out.probes.tasks = await probe("GET", "/api/tasks?done=false&limit=200", { headers: auth });
    if (out.probes.tasks.body && out.probes.tasks.body.data) {
      const tasks = out.probes.tasks.body.data.tasks || [];
      out.tasksSummary = {
        ok: out.probes.tasks.body.ok,
        n: tasks.length,
        dated: tasks.filter((t) => t && t.due_at).length,
        titlesAreUuids: tasks.filter((t) => t && /^[0-9a-f-]{36}$/i.test(String(t.title || ""))).length
      };
    } else if (out.probes.tasks.body && Array.isArray(out.probes.tasks.body.tasks)) {
      const tasks = out.probes.tasks.body.tasks;
      out.tasksSummary = { ok: out.probes.tasks.body.ok, n: tasks.length, dated: tasks.filter((t) => t && t.due_at).length };
    } else {
      out.tasksSummary = { status: out.probes.tasks.status, keys: out.probes.tasks.body && Object.keys(out.probes.tasks.body) };
    }
    out.probes.proxyLaunch = await probe("POST", "/api/proxy/launch", {
      headers: auth,
      body: { client_id: TEST_CLIENT, lender_id: FAKE_LENDER }
    });
  }
}

if (out.probes.tasks) {
  delete out.probes.tasks.body;
  out.probes.tasks.note = "task rows withheld — counts only in tasksSummary";
}
if (out.probes.workflows && out.probes.workflows.body && typeof out.probes.workflows.body === "object") {
  const b = out.probes.workflows.body;
  const rows = b.workflows || b.rows || b.items || [];
  out.probes.workflows.body = {
    ok: b.ok,
    engine_active: b.engine_active,
    n: Array.isArray(rows) ? rows.length : null,
    sample_ids: Array.isArray(rows) ? rows.slice(0, 8).map((r) => r.id) : []
  };
}

fs.writeFileSync(new URL("./live.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  inngestGet: { status: out.probes.inngestGet.status, preview: out.probes.inngestGet.bodyPreview },
  inngestHead: { status: out.probes.inngestHead.status },
  calcomForged: { status: out.probes.calcomForged.status, body: out.probes.calcomForged.body },
  calShort: { status: out.probes.calShort.status, body: out.probes.calShort.body },
  login: out.login,
  workflowsSummary: out.workflowsSummary,
  tasksSummary: out.tasksSummary,
  proxyLaunch: out.probes.proxyLaunch && {
    status: out.probes.proxyLaunch.status,
    error: out.probes.proxyLaunch.body && out.probes.proxyLaunch.body.error,
    message: out.probes.proxyLaunch.body && out.probes.proxyLaunch.body.message
  }
}, null, 2));

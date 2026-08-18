// P3 setup — fresh sim client + contract send to plus-tag. Findings only.
// Never writes FUNDHUB_TEST_INBOX onto a client row. Never touches live file.

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-response-loop-2026-08-19-evidence");
const DUMPS = path.join(OUT, "dumps");
const BASE = "https://fundhub.ai";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const P1_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const PRIOR_SIM = "41a3199f-1835-4ac8-91c0-d4f37bd92037";
const SIGN_NAME = "TEST — Response Loop";

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

const PASSWORD = process.env.STAFF_E2E_PASSWORD || process.env.STAFF_INITIAL_PASSWORD || "";
const TEST_INBOX = String(process.env.FUNDHUB_TEST_INBOX || "").trim().toLowerCase();
if (!PASSWORD) throw new Error("STAFF_E2E_PASSWORD missing");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
if (!TEST_INBOX || !TEST_INBOX.includes("@")) throw new Error("FUNDHUB_TEST_INBOX missing");

fs.mkdirSync(DUMPS, { recursive: true });
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });

function writeDump(name, obj) {
  const file = path.join(DUMPS, name);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  return path.relative(ROOT, file);
}

function db() {
  return new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function query(sql, params = []) {
  const c = db();
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

function plusTagAddress(unix) {
  const at = TEST_INBOX.lastIndexOf("@");
  const local = TEST_INBOX.slice(0, at);
  const domain = TEST_INBOX.slice(at + 1);
  return `${local}+e2e-loop-${unix}@${domain}`;
}

function pickTemplate(items) {
  const active = (items || []).filter((t) => t && t.active !== false);
  const funding = active.filter((t) => /funding|service/i.test(`${t.template_key || ""} ${t.subtype || ""} ${t.name || ""}`));
  const notDispute = active.filter((t) => !/dispute|letter|repair|authorization/i.test(
    `${t.template_key || ""} ${t.name || ""} ${t.subtype || ""}`
  ) || /funding|service|agreement/i.test(`${t.template_key || ""} ${t.subtype || ""}`));
  const soft = active.filter((t) => /SOFT-PULL-CONSENT|soft_pull/i.test(`${t.template_key || ""} ${t.subtype || ""}`));
  const picked = funding[0] || notDispute.find((t) => !/SOFT-PULL|CONSENT|DISPUTE/i.test(t.template_key || "")) || soft[0] || active[0] || null;
  return {
    picked,
    available: active.map((t) => ({
      id: t.id,
      template_key: t.template_key,
      name: t.name,
      kind: t.kind,
      subtype: t.subtype,
      active: t.active
    }))
  };
}

function fillValues(template) {
  const values = {};
  for (const f of template.manual_fields || []) {
    if (!f || !f.key) continue;
    if (f.required || f.required === true) values[f.key] = "TEST-AUDIT";
  }
  return values;
}

function linkFromSend(data) {
  const links = (data && data.links) || [];
  if (links[0]) return links[0].url || links[0].path || "";
  const link = data && data.link;
  if (!link) return "";
  if (typeof link === "string") return link;
  return link.url || link.path || "";
}

function absLink(link) {
  if (!link) return "";
  if (/^https?:\/\//i.test(link)) return link;
  return BASE + (link.startsWith("/") ? link : `/${link}`);
}

function redactRoutes(json) {
  const items = (json && (json.items || json.routes || json.items)) || [];
  const list = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : items;
  return (Array.isArray(list) ? list : []).map((r) => ({
    id: r.id || r.priority,
    priority: r.priority,
    description: r.description || null,
    expression_has_fundhub: /fundhub/i.test(String(r.expression || "")),
    expression_kind: /match_recipient/i.test(String(r.expression || "")) ? "match_recipient" : (r.expression ? "other" : null),
    actions: (r.actions || []).map((a) => {
      const s = String(a);
      const points_live = /fundhub\.ai\/api\/webhooks\/mailgun/i.test(s);
      const points_webhooks_mailgun = /\/api\/webhooks\/mailgun/i.test(s);
      const kind = /^forward/i.test(s) ? "forward" : (/^store/i.test(s) ? "store" : (/^stop/i.test(s) ? "stop" : "other"));
      return { kind, points_live_webhook: points_live, points_webhooks_mailgun };
    })
  }));
}

async function mailgunRoutes() {
  const key = process.env.MAILGUN_SEND_API_KEY || process.env.MAILGUN_API_KEY || "";
  const domain = process.env.MAILGUN_SEND_DOMAIN || "";
  const out = {
    MAILGUN_SEND_API_KEY_set: Boolean(key),
    MAILGUN_SEND_DOMAIN_set: Boolean(domain),
    MAILGUN_SEND_DOMAIN_is_mg_fundhub: domain === "mg.fundhub.ai",
    MAILGUN_SIGNING_KEY_set: Boolean(process.env.MAILGUN_SIGNING_KEY),
    routes_http: null,
    routes: [],
    receiving_http: null,
    error: null
  };
  if (!key) {
    out.error = "MAILGUN_SEND_API_KEY missing";
    return out;
  }
  const auth = "Basic " + Buffer.from(`api:${key}`).toString("base64");
  try {
    const res = await fetch("https://api.mailgun.net/v3/routes", { headers: { authorization: auth } });
    const json = await res.json().catch(() => ({}));
    out.routes_http = res.status;
    out.routes_total = json.total_count ?? (Array.isArray(json.items) ? json.items.length : null);
    out.routes = redactRoutes(json);
    out.has_route_to_live_webhook = out.routes.some((r) =>
      (r.actions || []).some((a) => a.points_live_webhook)
    );
    out.has_any_inbound_route = out.routes.length > 0;
  } catch (err) {
    out.error = "routes_fetch_failed";
  }
  if (domain) {
    try {
      const res = await fetch(`https://api.mailgun.net/v3/${domain}`, { headers: { authorization: auth } });
      out.domain_http = res.status;
      out.domain_ok = res.ok;
    } catch {
      out.domain_http = null;
    }
  }
  return out;
}

async function main() {
  const live = (await query(
    `SELECT id, lower(email) AS email, is_demo
       FROM clients WHERE id = $1`,
    [FORBIDDEN]
  ))[0] || null;

  const safety = {
    FUNDHUB_TEST_INBOX_set: true,
    live_file_present: Boolean(live),
    live_email_equals_inbox: Boolean(live && live.email && live.email === TEST_INBOX),
    will_not_write_bare_inbox_to_any_client: true
  };
  writeDump("00-safety.json", safety);
  if (!live || live.email !== TEST_INBOX) {
    // Still proceed, but record. Collision rule still forbids writing the bare inbox.
  }

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "chris@fundhub.ai", password: PASSWORD })
  });
  const loginJson = await loginRes.json().catch(() => ({}));
  const token = loginJson.token || null;
  writeDump("01-login.json", {
    status: loginRes.status,
    ok: loginJson.ok === true,
    has_token: Boolean(token),
    staff_role: loginJson.staff?.role || null
  });
  if (!token) throw new Error("login failed");

  const authHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    cookie: `fundhub_session=${token}`
  };

  const simRes = await fetch(`${BASE}/api/demo/simulate`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({})
  });
  const simJson = await simRes.json().catch(() => ({}));
  const clientId = simJson.client_id || null;
  writeDump("02-simulate.json", {
    status: simRes.status,
    ok: simJson.ok === true,
    client_id: clientId,
    has_email: Boolean(simJson.email),
    email_is_demo_local: /@demo\.fundhub\.local$/i.test(String(simJson.email || "")),
    email_equals_bare_inbox: String(simJson.email || "").trim().toLowerCase() === TEST_INBOX,
    tradeline_count: simJson.tradeline_count || null,
    card_id: simJson.card_id || null,
    crs_id: simJson.crs_id || null
  });

  if (!clientId) throw new Error("simulate failed");
  if (clientId === FORBIDDEN || clientId === P1_CLIENT || clientId === PRIOR_SIM) {
    throw new Error("simulate returned a forbidden or reserved id");
  }
  if (String(simJson.email || "").trim().toLowerCase() === TEST_INBOX) {
    throw new Error("simulate email is bare inbox — abort");
  }

  const unix = Date.now();
  const tag = plusTagAddress(unix);
  if (tag.toLowerCase() === TEST_INBOX) throw new Error("plus-tag collapsed to bare inbox");

  const clientRow = (await query(
    `SELECT id, org_id, is_demo, lower(email) AS email FROM clients WHERE id = $1`,
    [clientId]
  ))[0] || null;
  if (!clientRow || clientRow.is_demo !== true) throw new Error("sim client not is_demo");
  if (clientRow.email === TEST_INBOX) throw new Error("client row already has bare inbox");

  const tplRes = await fetch(`${BASE}/api/read/contracts?view=templates&active_only=1`, { headers: authHeaders });
  const tplJson = await tplRes.json().catch(() => ({}));
  const items = (tplJson && (tplJson.items || tplJson.templates || (tplJson.data && (tplJson.data.items || tplJson.data.templates)))) || [];
  const pick = pickTemplate(items);
  writeDump("03-templates.json", {
    status: tplRes.status,
    ok: tplJson.ok,
    count: items.length,
    picked_key: pick.picked && pick.picked.template_key
  });
  if (!pick.picked) throw new Error("no contract template");

  const draftBody = {
    action: "create_draft",
    client_id: clientId,
    template_id: pick.picked.id,
    values: fillValues(pick.picked),
    title: pick.picked.name || pick.picked.template_key,
    signers: [{
      role_label: "Client",
      name: SIGN_NAME,
      email: tag,
      client_id: clientId
    }]
  };

  const draftRes = await fetch(`${BASE}/api/contracts`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(draftBody)
  });
  const draftJson = await draftRes.json().catch(() => ({}));
  const draftContract = draftJson.contract || null;
  writeDump("04-create-draft.json", {
    status: draftRes.status,
    ok: draftJson.ok === true,
    error: draftJson.error || null,
    message: draftJson.message || null,
    template_key: pick.picked.template_key,
    contract_id: draftContract && draftContract.id,
    signer_count: Array.isArray(draftJson.signers) ? draftJson.signers.length : null,
    signer_email_is_plus_tag: true,
    signer_email_is_bare_inbox: false,
    client_email_unchanged_demo: clientRow.email !== TEST_INBOX && /@demo\.fundhub\.local$/i.test(clientRow.email || "")
  });
  if (!draftContract || !draftContract.id) throw new Error("create_draft failed");

  const afterDraftClient = (await query(
    `SELECT id, lower(email) AS email FROM clients WHERE id = $1`,
    [clientId]
  ))[0];
  const liveAfterDraft = (await query(
    `SELECT id, lower(email) AS email FROM clients WHERE id = $1`,
    [FORBIDDEN]
  ))[0];
  if (afterDraftClient.email === TEST_INBOX) throw new Error("draft wrote bare inbox onto sim client");
  if (liveAfterDraft && liveAfterDraft.email !== (live && live.email)) {
    throw new Error("live file email changed — abort");
  }

  const sendRes = await fetch(`${BASE}/api/contracts`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ action: "send", id: draftContract.id })
  });
  const sendJson = await sendRes.json().catch(() => ({}));
  const sent = sendJson.contract || null;
  const signLink = absLink(linkFromSend(sendJson));
  writeDump("05-send.json", {
    status: sendRes.status,
    ok: sendJson.ok === true,
    error: sendJson.error || null,
    message: sendJson.message || null,
    contract_id: sent && sent.id,
    contract_status: sent && sent.status,
    has_link: Boolean(signLink),
    link_is_absolute: /^https?:\/\//i.test(signLink),
    link_host_is_fundhub: /fundhub\.ai/i.test(signLink)
  });

  const msgRows = await query(
    `SELECT id, template_key, channel, status, provider, to_address IS NOT NULL AS has_to,
            length(to_address) AS to_len, created_at
       FROM messages
      WHERE client_id = $1
      ORDER BY created_at DESC`,
    [clientId]
  );
  const signerRows = await query(
    `SELECT id, status, viewed_at, view_count, email IS NOT NULL AS has_email,
            lower(email) = $2 AS email_is_plus_tag
       FROM contract_signers WHERE contract_id = $1`,
    [draftContract.id, tag]
  );
  writeDump("06-after-send-db.json", {
    messages: msgRows.map((m) => ({
      id: m.id,
      template_key: m.template_key,
      channel: m.channel,
      status: m.status,
      provider: m.provider,
      has_to: m.has_to,
      created_at: m.created_at
    })),
    signers: signerRows,
    client_email_still_demo: /@demo\.fundhub\.local$/i.test(afterDraftClient.email || ""),
    live_email_still_inbox: Boolean(liveAfterDraft && liveAfterDraft.email === TEST_INBOX)
  });

  const routes = await mailgunRoutes();
  writeDump("07-mailgun-routes.json", routes);

  const ids = {
    client_id: clientId,
    org_id: clientRow.org_id,
    contract_id: draftContract.id,
    card_id: simJson.card_id || null,
    crs_id: simJson.crs_id || null,
    plus_tag_suffix: `e2e-loop-${unix}`,
    sign_link_present: Boolean(signLink),
    created_unix: unix
  };
  writeDump("ids.json", ids);
  // Session with the plus-tag lives outside the repo so it cannot be committed.
  fs.writeFileSync("/tmp/p3-response-loop-session.json", JSON.stringify({
    ...ids,
    sign_link: signLink,
    plus_tag: tag
  }, null, 2));

  console.log(JSON.stringify({
    ok: true,
    client_id: clientId,
    contract_id: draftContract.id,
    send_status: sendRes.status,
    contract_status: sent && sent.status,
    has_link: Boolean(signLink),
    mail_rows: msgRows.length,
    mailgun_has_live_route: routes.has_route_to_live_webhook || false,
    mailgun_route_count: routes.routes_total,
    plus_tag_suffix: `e2e-loop-${unix}`
  }));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});

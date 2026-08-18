// F-MAIL fire probe. Writes sanitized evidence only. Never prints addresses, keys, or full tokens.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-untested-fire-2026-08-18-evidence/f-mail");
const TEST = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const LIVE = "9af65808-a619-4e65-ae91-239766a006b7";
const BASE = "https://fundhub.ai";
const RECIPIENT = "replies@mg.fundhub.ai";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
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

function dump(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2) + "\n");
}

function plusFromInbox(inbox) {
  const at = inbox.indexOf("@");
  if (at < 1) throw new Error("inbox_malformed");
  return inbox.slice(0, at) + "+e2e-fire" + inbox.slice(at);
}

function isPlusTagOfInbox(email, inbox) {
  const e = String(email || "").trim().toLowerCase();
  const i = String(inbox || "").trim().toLowerCase();
  if (!e || !i || e === i) return false;
  const [ilocal, idomain] = i.split("@");
  const [elocal, edomain] = e.split("@");
  return Boolean(ilocal && idomain && elocal && edomain
    && edomain === idomain
    && elocal.startsWith(ilocal + "+"));
}

function emailShape(email, inbox, plus) {
  const e = String(email || "").trim().toLowerCase();
  return {
    has_email: Boolean(e),
    eq_bare_inbox: e === inbox,
    eq_plus: e === plus,
    is_plus_tag_of_inbox: isPlusTagOfInbox(e, inbox),
    domain_fundhub_ai: e.endsWith("@fundhub.ai")
  };
}

function tokenLast4FromUrl(url) {
  try {
    const t = new URL(url).searchParams.get("t") || "";
    return t.length >= 4 ? t.slice(-4) : null;
  } catch {
    return null;
  }
}

function extractPortalLink(text) {
  const body = String(text || "");
  const match = body.match(/https?:\/\/[^\s"'<>]+portal-login\.html\?t=[A-Za-z0-9_-]+/i);
  if (!match) return null;
  return match[0].replace(/[.,);]+$/, "");
}

function signMailgun(signingKey) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const token = crypto.randomBytes(16).toString("hex");
  const signature = crypto.createHmac("sha256", signingKey).update(timestamp + token).digest("hex");
  return { timestamp, token, signature };
}

loadDotEnv();
fs.mkdirSync(OUT, { recursive: true });

const inbox = String(process.env.FUNDHUB_TEST_INBOX || "").trim().toLowerCase();
const plus = plusFromInbox(inbox);
const signingKey = process.env.MAILGUN_SIGNING_KEY || "";
const resendKey = process.env.RESEND_API_KEY || "";
const staffPassword = process.env.STAFF_E2E_PASSWORD || "";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
if (!inbox) throw new Error("FUNDHUB_TEST_INBOX missing");
if (plus === inbox) throw new Error("plus collapsed to bare inbox");
if (!signingKey) throw new Error("MAILGUN_SIGNING_KEY missing");
if (!staffPassword) throw new Error("STAFF_E2E_PASSWORD missing");

dump("00-env-names.json", {
  FUNDHUB_TEST_INBOX_set: Boolean(inbox),
  RESEND_API_KEY_set: Boolean(resendKey),
  MAILGUN_SIGNING_KEY_set: Boolean(signingKey),
  STAFF_E2E_PASSWORD_set: Boolean(staffPassword),
  DATABASE_URL_set: Boolean(process.env.DATABASE_URL),
  plus_eq_bare_inbox: false,
  plus_has_e2e_fire_tag: plus.includes("+e2e-fire@")
});

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await c.connect();

const before = await c.query(
  `SELECT
     (SELECT lower(email) FROM clients WHERE id = $1::uuid) AS test_email,
     (SELECT lower(email) FROM clients WHERE id = $2::uuid) AS live_email,
     (SELECT json_agg(json_build_object('id', id, 'kind', kind, 'status', status, 'email', lower(email)))
        FROM accounts WHERE client_id = $1::uuid) AS test_accounts,
     (SELECT count(*)::int FROM clients WHERE lower(email) = $3 AND id <> $1::uuid) AS plus_on_other_clients,
     (SELECT count(*)::int FROM accounts WHERE lower(email) = $3 AND (client_id IS DISTINCT FROM $1::uuid)) AS plus_on_other_accounts`,
  [TEST, LIVE, plus]
);

const testEmailBefore = before.rows[0].test_email || "";
const liveEmailBefore = before.rows[0].live_email || "";
const testAccounts = before.rows[0].test_accounts || [];
const alreadyPlusTag = isPlusTagOfInbox(testEmailBefore, inbox);
const usedPlus = alreadyPlusTag ? testEmailBefore : plus;

if (liveEmailBefore === plus || (alreadyPlusTag === false && before.rows[0].plus_on_other_clients > 0 && usedPlus === plus)) {
  // Collision with live or others only blocks if we would write plus onto TEST.
}

const align = {
  already_plus_tag_of_inbox: alreadyPlusTag,
  would_write_plus: !alreadyPlusTag,
  plus_on_other_clients: before.rows[0].plus_on_other_clients,
  plus_on_other_accounts: before.rows[0].plus_on_other_accounts,
  live_eq_bare_inbox: liveEmailBefore === inbox,
  live_eq_plus: liveEmailBefore === plus,
  test_before: emailShape(testEmailBefore, inbox, plus),
  account_count: testAccounts.length,
  accounts_before: testAccounts.map((a) => ({
    kind: a.kind,
    status: a.status,
    shape: emailShape(a.email, inbox, plus)
  })),
  wrote: false,
  skipped_reason: null
};

if (liveEmailBefore === plus) {
  align.skipped_reason = "plus_equals_live_email";
  dump("01-align.json", align);
  await c.end();
  throw new Error("plus equals live file email — stop");
}

if (!alreadyPlusTag && (before.rows[0].plus_on_other_clients > 0 || before.rows[0].plus_on_other_accounts > 0)) {
  align.skipped_reason = "plus_already_on_another_row";
  dump("01-align.json", align);
  await c.end();
  throw new Error("plus already on another client/account — stop");
}

if (!alreadyPlusTag) {
  await c.query("BEGIN");
  await c.query(
    `UPDATE clients SET email = $2 WHERE id = $1::uuid AND id <> $3::uuid`,
    [TEST, plus, LIVE]
  );
  await c.query(
    `UPDATE accounts SET email = $2 WHERE client_id = $1::uuid AND kind = 'client'`,
    [TEST, plus]
  );
  const liveAfterWrite = await c.query(`SELECT lower(email) AS email FROM clients WHERE id = $1::uuid`, [LIVE]);
  if (liveAfterWrite.rows[0].email !== liveEmailBefore) {
    await c.query("ROLLBACK");
    align.skipped_reason = "live_email_would_have_changed";
    dump("01-align.json", align);
    await c.end();
    throw new Error("live email changed — rolled back");
  }
  await c.query("COMMIT");
  align.wrote = true;
}

const after = await c.query(
  `SELECT
     (SELECT lower(email) FROM clients WHERE id = $1::uuid) AS test_email,
     (SELECT lower(email) FROM clients WHERE id = $2::uuid) AS live_email,
     (SELECT json_agg(json_build_object('kind', kind, 'status', status, 'email', lower(email)))
        FROM accounts WHERE client_id = $1::uuid) AS test_accounts`,
  [TEST, LIVE]
);
const testEmail = after.rows[0].test_email || "";
const used = isPlusTagOfInbox(testEmail, inbox) ? testEmail : usedPlus;
align.test_after = emailShape(testEmail, inbox, plus);
align.live_after_eq_before = after.rows[0].live_email === liveEmailBefore;
align.live_still_eq_inbox = after.rows[0].live_email === inbox;
align.accounts_after = (after.rows[0].test_accounts || []).map((a) => ({
  kind: a.kind,
  status: a.status,
  shape: emailShape(a.email, inbox, plus)
}));
align.used_is_plus_tag = isPlusTagOfInbox(used, inbox);
align.used_eq_bare_inbox = used === inbox;
dump("01-align.json", align);

if (used === inbox || !isPlusTagOfInbox(used, inbox)) {
  await c.end();
  throw new Error("refusing to send to bare inbox or non-plus-tag");
}

const outboundBefore = await c.query(
  `SELECT count(*)::int AS n,
          count(*) FILTER (WHERE direction = 'outbound' AND channel = 'email')::int AS outbound_email,
          count(*) FILTER (WHERE direction = 'inbound' AND channel = 'email')::int AS inbound_email
     FROM messages WHERE client_id = $1::uuid`,
  [TEST]
);

const staffLogin = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "chris@fundhub.ai", password: staffPassword })
});
const staffJson = await staffLogin.json().catch(() => ({}));
const staffToken = staffJson.token || null;
dump("02-staff-login.json", {
  status: staffLogin.status,
  ok: staffJson.ok === true,
  has_token: Boolean(staffToken)
});

let staffSend = { attempted: false };
if (staffToken) {
  const sendRes = await fetch(`${BASE}/api/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${staffToken}`
    },
    body: JSON.stringify({
      client_id: TEST,
      channel: "email",
      subject: "e2e fire thread — ignore",
      body: "e2e fire thread — ignore. Test message only.",
      idempotency_key: `f-mail-thread-${Date.now()}`
    })
  });
  const sendJson = await sendRes.json().catch(() => ({}));
  staffSend = {
    attempted: true,
    status: sendRes.status,
    ok: sendJson.ok === true,
    outcome: sendJson.outcome || null,
    has_conversation_id: Boolean(sendJson.conversation_id),
    detail: sendJson.detail ? String(sendJson.detail).slice(0, 120) : null,
    error: sendJson.error || null
  };
}
dump("03-staff-send.json", staffSend);

const magicReq = await fetch(`${BASE}/api/auth/magic-link`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: used })
});
const magicJson = await magicReq.json().catch(() => ({}));
dump("04-magic-request.json", {
  status: magicReq.status,
  ok: magicJson.ok === true,
  has_message: Boolean(magicJson.message),
  requested_plus_tag: true,
  requested_bare_inbox: false
});

await new Promise((r) => setTimeout(r, 2500));

const magicRows = await c.query(
  `SELECT id, outcome, (consumed_at IS NOT NULL) AS consumed,
          (expires_at > now()) AS not_expired,
          (lower(email) = $2) AS email_eq_used,
          (lower(email) = $3) AS email_eq_inbox,
          created_at
     FROM account_magic_links
    WHERE client_id = $1::uuid
    ORDER BY created_at DESC
    LIMIT 5`,
  [TEST, used, inbox]
);

const msgs = await c.query(
  `SELECT id, status, provider, template_key, direction, channel,
          (rendered_body IS NOT NULL) AS has_body,
          created_at, rendered_body
     FROM messages
    WHERE client_id = $1::uuid
      AND (
        template_key = 'EMAIL-PORTAL-MAGIC-LINK'
        OR (direction = 'outbound' AND channel = 'email')
      )
    ORDER BY created_at DESC
    LIMIT 8`,
  [TEST]
);

let link = null;
let linkSource = null;
for (const m of msgs.rows) {
  const found = extractPortalLink(m.rendered_body);
  if (found) {
    link = found;
    linkSource = "messages.rendered_body";
    break;
  }
}

let resendHit = { attempted: Boolean(resendKey), listed: 0, extracted_link: false };
if (!link && resendKey) {
  try {
    const rr = await fetch("https://api.resend.com/emails?limit=20", {
      headers: { authorization: `Bearer ${resendKey}` }
    });
    const rj = await rr.json().catch(() => ({}));
    const list = Array.isArray(rj.data) ? rj.data : [];
    resendHit.listed = list.length;
    resendHit.http = rr.status;
    for (const em of list) {
      const toList = [].concat(em.to || []);
      const toHit = toList.some((t) => String(t).trim().toLowerCase() === used);
      if (!toHit) continue;
      const blob = `${em.html || ""} ${em.text || ""} ${em.subject || ""}`;
      const found = extractPortalLink(blob);
      if (found) {
        link = found;
        linkSource = "resend_api";
        resendHit.extracted_link = true;
        break;
      }
    }
  } catch (err) {
    resendHit.error = "resend_list_failed";
  }
}

if (link) {
  fs.writeFileSync("/tmp/f-mail-magic-link.txt", link);
}

dump("05-magic-rows.json", {
  links: magicRows.rows,
  latest_issued: magicRows.rows[0] || null
});
dump("06-magic-link.json", {
  extracted: Boolean(link),
  source: linkSource,
  host: link ? new URL(link).host : null,
  path: link ? new URL(link).pathname : null,
  has_t: link ? Boolean(new URL(link).searchParams.get("t")) : false,
  token_last4: link ? tokenLast4FromUrl(link) : null,
  resend: resendHit,
  message_statuses: msgs.rows.map((m) => ({
    id: m.id,
    status: m.status,
    provider: m.provider,
    template_key: m.template_key,
    has_body: m.has_body,
    created_at: m.created_at
  }))
});

async function postMailgun({ subject, text, messageId }) {
  const sig = signMailgun(signingKey);
  const body = {
    signature: { timestamp: sig.timestamp, token: sig.token, signature: sig.signature },
    timestamp: sig.timestamp,
    token: sig.token,
    from: used,
    sender: used,
    subject,
    "body-plain": text,
    "stripped-text": text,
    recipient: RECIPIENT,
    "Message-Id": messageId
  };
  const res = await fetch(`${BASE}/api/webhooks/mailgun`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return {
    status: res.status,
    ok: json.ok === true,
    reason: json.reason || null,
    emitted_names: Array.isArray(json.emitted) ? json.emitted.map((e) => e.name) : null,
    emitted_count: Array.isArray(json.emitted) ? json.emitted.length : null,
    has_inbound_emit: Array.isArray(json.emitted) && json.emitted.some((e) => e.name === "message.inbound"),
    has_mail_response_emit: Array.isArray(json.emitted) && json.emitted.some((e) => e.name === "mail.response")
  };
}

const replyPost = await postMailgun({
  subject: "e2e fire reply — ignore",
  text: "e2e fire reply — ignore",
  messageId: `<f-mail-reply-${Date.now()}@e2e.fundhub.local>`
});
dump("07-inbound-reply.json", replyPost);

await new Promise((r) => setTimeout(r, 1500));

const stopPost = await postMailgun({
  subject: "STOP",
  text: "STOP",
  messageId: `<f-mail-stop-${Date.now()}@e2e.fundhub.local>`
});
dump("08-inbound-stop.json", stopPost);

await new Promise((r) => setTimeout(r, 1500));

const unsubDoors = {};
for (const p of ["/api/unsubscribe", "/unsubscribe", "/app/unsubscribe.html"]) {
  try {
    const res = await fetch(`${BASE}${p}`, { method: "GET" });
    unsubDoors[p] = { status: res.status, ok: res.ok };
  } catch {
    unsubDoors[p] = { error: "fetch_failed" };
  }
}
dump("09-unsub-doors.json", unsubDoors);

const events = await c.query(
  `SELECT name, count(*)::int AS n, max(created_at) AS last_at
     FROM events
    WHERE client_id = $1::uuid
      AND name IN ('message.inbound', 'mail.response')
      AND created_at > now() - interval '20 minutes'
    GROUP BY name
    ORDER BY name`,
  [TEST]
);

const inboundMsgs = await c.query(
  `SELECT id, direction, channel, status, subject,
          (rendered_body ILIKE '%e2e fire reply%') AS body_is_reply,
          (upper(trim(rendered_body)) = 'STOP') AS body_is_stop,
          created_at
     FROM messages
    WHERE client_id = $1::uuid
      AND direction = 'inbound'
      AND created_at > now() - interval '20 minutes'
    ORDER BY created_at DESC`,
  [TEST]
);

const optOuts = await c.query(
  `SELECT channel, source, (opted_in_at IS NULL) AS currently_out, opted_out_at, opted_in_at
     FROM opt_outs
    WHERE client_id = $1::uuid
    ORDER BY channel`,
  [TEST]
);

const liveOpt = await c.query(
  `SELECT count(*)::int AS n FROM opt_outs WHERE client_id = $1::uuid`,
  [LIVE]
);

const convos = await c.query(
  `SELECT id, channel, last_message_at
     FROM conversations
    WHERE client_id = $1::uuid
    ORDER BY last_message_at DESC NULLS LAST
    LIMIT 5`,
  [TEST]
);

dump("10-events.json", { test_client: events.rows, outbound_before: outboundBefore.rows[0] });
dump("11-inbound-messages.json", inboundMsgs.rows);
dump("12-opt-outs.json", {
  test_rows: optOuts.rows,
  live_opt_out_count: liveOpt.rows[0].n,
  email_currently_out: optOuts.rows.some((r) => r.channel === "email" && r.currently_out)
});
dump("13-conversations.json", {
  n: convos.rows.length,
  channels: convos.rows.map((r) => r.channel)
});

await c.end();

console.log(JSON.stringify({
  wrote_plus: align.wrote,
  used_plus_tag: align.used_is_plus_tag,
  used_bare: align.used_eq_bare_inbox,
  live_unchanged: align.live_after_eq_before,
  magic_status: magicReq.status,
  link: Boolean(link),
  reply_status: replyPost.status,
  reply_inbound: replyPost.has_inbound_emit,
  stop_status: stopPost.status,
  inbound_rows: inboundMsgs.rows.length,
  email_opted_out: optOuts.rows.some((r) => r.channel === "email" && r.currently_out)
}));

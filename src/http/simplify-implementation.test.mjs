import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listBankInbox } from "../../api/read/bank-inbox.mjs";
import { saveClientNotes } from "../../api/client-notes.mjs";
import { supersedeCommissionRule } from "../../api/commission-rules.mjs";
import { SQL_SUPERSEDE_RULE } from "../commissions/sql.mjs";
import { db } from "../db.mjs";
import bankInboxHandler from "../../api/read/bank-inbox.mjs";
import clientNotesHandler from "../../api/client-notes.mjs";
import commissionRulesHandler from "../../api/commission-rules.mjs";
import portalSummaryHandler from "../../api/read/portal-summary.mjs";

const ROOT = new URL("../../", import.meta.url);
const text = (path) => readFileSync(new URL(path, ROOT), "utf8");

test("Bank Inbox reads one client inside the session org and never returns raw payloads", async () => {
  let call;
  const result = await listBankInbox((sql, params) => {
    call = { sql, params };
    return Promise.resolve({ rows: [] });
  }, { orgId: "org-1", clientId: "client-1", limit: 25, offset: 0 });

  assert.deepEqual(result.rows, []);
  assert.match(call.sql, /WHERE org_id = \$1::uuid[\s\S]*AND client_id = \$2::uuid/);
  assert.doesNotMatch(call.sql, /\braw\b/);
  assert.deepEqual(call.params, ["org-1", "client-1", 26, 0]);
});

test("client notes update only the named client inside the session org", async () => {
  let call;
  await saveClientNotes((sql, params) => {
    call = { sql, params };
    return Promise.resolve({ rows: [{ id: "client-1" }] });
  }, { orgId: "org-1", clientId: "client-1", notes: "Call Friday." });

  assert.match(call.sql, /jsonb_set[\s\S]*\{staff_notes\}/);
  assert.match(call.sql, /WHERE id = \$1::uuid[\s\S]*AND org_id = \$2::uuid/);
  assert.deepEqual(call.params, ["client-1", "org-1", "Call Friday."]);
});

test("commission changes close the live row and insert a dated replacement", async () => {
  const calls = [];
  const old = {
    id: "11111111-1111-1111-1111-111111111111",
    org_id: "22222222-2222-2222-2222-222222222222",
    name: "Closer — funding deposit",
    description: "Deposit share", basis: "front_end", stacking: "base",
    product_id: "33333333-3333-3333-3333-333333333333", role: "closer",
    staff_id: null, calc_method: "percent", percent: "10", flat_amount: null,
    per_unit_amount: null, tier_mode: "marginal", amount_basis: "deposit_collected",
    min_amount: null, max_amount: null, effective_from: "2026-01-01T00:00:00Z",
    effective_to: null, active: true, notes: null
  };
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (/FOR UPDATE/.test(sql)) return { rows: [old] };
    if (sql === SQL_SUPERSEDE_RULE) {
      return { rows: [{ id: old.id, effective_to: params[1] }] };
    }
    if (/INSERT INTO commission_rules/.test(sql)) {
      return { rows: [{ ...old, id: "44444444-4444-4444-4444-444444444444", percent: params[9] }] };
    }
    throw new Error("unexpected query");
  };

  const result = await supersedeCommissionRule(query, {
    orgId: old.org_id,
    ruleId: old.id,
    effectiveFrom: "2026-08-20",
    rate: 16.67,
    reason: "Owner-set 2026-08-20"
  });

  assert.equal(result.status, 200);
  assert.match(calls[1].sql, /SET effective_to/);
  assert.doesNotMatch(calls[1].sql, /SET[\s\S]*percent\s*=/);
  assert.equal(calls[2].params[9], 16.67);
  assert.equal(calls[2].params[16], "2026-08-20T00:00:00.000Z");
});

test("approved simplify controls are removed and real jobs are wired", () => {
  const pipeline = text("public/app/pipeline.html");
  assert.doesNotMatch(pipeline, /rt-count|boardArchiveTop|showLenderMatches/);
  assert.match(pipeline, /div\("c-scores"/);
  assert.doesNotMatch(pipeline, /var scores = sec\("Scores"\)/);

  const ccp = text("public/app/client-control-panel.html");
  assert.doesNotMatch(ccp, /ccp-chip-credit|Raw Report/);
  assert.match(ccp, /\/api\/client-notes/);
  assert.match(ccp, /read\("bank-inbox"/);

  const portal = text("public/app/client-portal.html");
  assert.doesNotMatch(portal, /st-precall|st-progress|st-funded|class="statesw"/);
  assert.match(portal, /Open this client in Documents/);

  const specialist = text("public/app/inquiry-remover.html");
  assert.doesNotMatch(specialist, /id="cases-panel"|id="cases-list"/);
  assert.match(specialist, /class="letter-edit" readonly/);
  assert.match(specialist, /documents\.html\?client_id=/);
});

test("the remaining approved simplify rows stay enforced", () => {
  const messaging = text("public/app/messaging.html");
  assert.doesNotMatch(messaging, /id="ctxName"/);
  assert.match(messaging, /placeholder = "Write a message…"/);
  assert.doesNotMatch(messaging, /live conversations · " \+ state\.rows\.length/);

  const documents = text("public/app/documents.html");
  assert.doesNotMatch(documents, /OLDEST PENDING|id="kOld"/);
  assert.doesNotMatch(documents, /live documents · " \+ mapped\.length \+ " records/);

  const calendar = text("public/app/calendar.html");
  assert.match(calendar, /data-task-id=/);
  assert.match(calendar, /selectedId = eventBlock\.dataset\.taskId/);
  assert.match(calendar, /todayN \? " · " \+ todayN \+ " today" : ""/);

  const products = text("public/app/products-commissions.html");
  assert.match(products, /<th>Price<\/th>/);
  assert.doesNotMatch(products, /<th>Default price<\/th>|<th>Min<\/th>|<th>Max<\/th>/);
  assert.doesNotMatch(products, /live product ladder · " \+ rows\.length/);
  assert.match(products, /t\.min_amount/);
  assert.match(products, /t\.max_amount/);
  assert.match(products, /t\.percent/);
  assert.doesNotMatch(products, /t\.(?:lo|hi|rate)\b/);

  const content = text("public/app/content-admin.html");
  assert.doesNotMatch(content, /saveTilesBtn/);

  const salesFloor = text("public/app/sales-floor.html");
  assert.doesNotMatch(salesFloor, /Flag to marketing|Today's recordings<\/button>/);
  assert.match(text("public/app/sales-floor.js"), /Sync recordings from Drive/);

  const staff = text("public/app/staff-teams.html");
  assert.doesNotMatch(staff, /id="ed_active"|id="ed_clock"/);
  assert.match(staff, /\['ed_first','ed_last','ed_email','ed_phone','ed_start'\][\s\S]*readOnly=true/);
});

test("owner-set commission rows use percent units and do not invent manager upsell", () => {
  const migration = text("db/migrations/246_owner_commission_rates_20260820.sql");
  assert.match(migration, /'percent', 16\.67, 'deposit_collected'/);
  assert.match(migration, /'percent', 5\.00, 'deposit_collected'/);
  assert.match(migration, /'percent', 0\.25, 'amount_funded'/);
  assert.equal((migration.match(/INSERT INTO commission_rules/g) || []).length, 4);
  assert.doesNotMatch(migration, /'[^']*downsell[^']*'/i);
  assert.doesNotMatch(migration, /Manager[^'\n]*upsell/i);
  assert.match(migration, /durable sale_motion plus product identity source/);
});


const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const OTHER_CLIENT = "33333333-3333-4333-8333-333333333333";
const realDbQuery = db.query;

afterEach(() => { db.query = realDbQuery; });

function response() {
  return {
    statusCode: null, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; }
  };
}

function request(overrides = {}) {
  return {
    method: "GET",
    headers: { authorization: "Bearer test-token" },
    query: {}, body: {},
    ...overrides
  };
}

function staffDatabase({ role = "owner", orgId = ORG, data } = {}) {
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM live JOIN staff s/i.test(sql)) {
      return { rows: [{
        session_id: "session-1", expires_at: new Date(Date.now() + 3600000),
        staff_id: "44444444-4444-4444-8444-444444444444", org_id: orgId,
        role, email: "staff@example.com", name: "Staff", status: "active", active_flag: "true"
      }] };
    }
    if (data) return data(sql, params, calls);
    return { rows: [] };
  };
  return calls;
}

function clientDatabase({ documents = [] } = {}) {
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM live JOIN staff s/i.test(sql)) return { rows: [] };
    if (/UPDATE account_sessions/i.test(sql)) {
      return { rows: [{ id: "account-session-1", account_id: "55555555-5555-4555-8555-555555555555", org_id: ORG, expires_at: new Date(Date.now() + 3600000) }] };
    }
    if (/FROM accounts WHERE id/i.test(sql)) {
      return { rows: [{
        id: "55555555-5555-4555-8555-555555555555", org_id: ORG,
        kind: "client", email: "client@example.com", name: "Client", status: "active",
        client_id: CLIENT, affiliate_id: null, partner_id: null
      }] };
    }
    if (/SELECT id, custom_fields FROM clients/i.test(sql)) {
      return { rows: [{ id: CLIENT, custom_fields: {} }] };
    }
    if (/FROM documents/i.test(sql)) return { rows: documents };
    throw new Error("unexpected query: " + sql);
  };
  return calls;
}

test("actual simplify handlers refuse unsigned requests", async () => {
  db.query = async () => ({ rows: [] });
  for (const [handler, req] of [
    [bankInboxHandler, request({ headers: {}, query: { client_id: CLIENT } })],
    [clientNotesHandler, request({ method: "POST", headers: {}, body: { client_id: CLIENT, notes: "x" } })],
    [commissionRulesHandler, request({ headers: {} })],
    [portalSummaryHandler, request({ headers: {} })]
  ]) {
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "unauthorized");
  }
});

test("Bank Inbox handler enforces staff role, org, client scope, and safe fields", async () => {
  let calls = staffDatabase({
    data(sql) {
      if (/SELECT 1 FROM clients/i.test(sql)) return { rows: [{ ok: 1 }] };
      if (/FROM bank_inbox/i.test(sql)) {
        return { rows: [{ id: "inbox-1", client_id: CLIENT, subject: "Deposit", body_preview: "Cleared" }] };
      }
      return { rows: [] };
    }
  });
  let res = response();
  await bankInboxHandler(request({ query: { client_id: CLIENT } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items[0].subject, "Deposit");
  assert.equal("raw" in res.body.items[0], false);
  assert.ok(calls.some((call) => /FROM bank_inbox/i.test(call.sql) && call.params[0] === ORG && call.params[1] === CLIENT));

  staffDatabase({ role: "affiliate" });
  res = response();
  await bankInboxHandler(request({ query: { client_id: CLIENT } }), res);
  assert.equal(res.statusCode, 403);

  staffDatabase({ orgId: null });
  res = response();
  await bankInboxHandler(request({ query: { client_id: CLIENT } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "no_org_on_session");

  const deniedCalls = staffDatabase({
    data(sql) {
      if (/SELECT 1 FROM clients/i.test(sql)) return { rows: [] };
      throw new Error("bank inbox read must not run for a client outside the session org");
    }
  });
  res = response();
  await bankInboxHandler(request({ query: { client_id: OTHER_CLIENT } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "not_found");
  assert.equal(deniedCalls.some((call) => /FROM bank_inbox/i.test(call.sql)), false);
});

test("client notes handler gates the real write by role and session org", async () => {
  const calls = staffDatabase({
    data(sql) {
      if (/SELECT 1 FROM clients/i.test(sql)) return { rows: [{ ok: 1 }] };
      if (/UPDATE clients/i.test(sql)) return { rows: [{ id: CLIENT, staff_notes: "Call Friday." }] };
      return { rows: [] };
    }
  });
  let res = response();
  await clientNotesHandler(request({
    method: "POST", body: { client_id: CLIENT, notes: "Call Friday.", org_id: "attacker-org" }
  }), res);
  assert.equal(res.statusCode, 200);
  const write = calls.find((call) => /UPDATE clients/i.test(call.sql));
  assert.deepEqual(write.params, [CLIENT, ORG, "Call Friday."]);

  staffDatabase({ role: "affiliate" });
  res = response();
  await clientNotesHandler(request({ method: "POST", body: { client_id: CLIENT, notes: "x" } }), res);
  assert.equal(res.statusCode, 403);
});

test("commission rules handler applies auth, finance role, and session org on reads", async () => {
  const calls = staffDatabase({
    role: "sales_manager",
    data(sql) {
      if (/FROM commission_rules r/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  });
  let res = response();
  await commissionRulesHandler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.ok(calls.some((call) => /FROM commission_rules r/i.test(call.sql) && call.params[0] === ORG));

  staffDatabase({ role: "setter" });
  res = response();
  await commissionRulesHandler(request(), res);
  assert.equal(res.statusCode, 403);

  staffDatabase({ role: "owner", orgId: null });
  res = response();
  await commissionRulesHandler(request(), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "no_org_on_session");
});

test("client portal summary ignores requested client ids and returns only session-owned documents", async () => {
  const documents = [{
    id: "66666666-6666-4666-8666-666666666666", document_key: "bank-statement",
    title: "Bank statement", mime_type: "application/pdf", created_at: "2026-08-20T12:00:00Z"
  }];
  const calls = clientDatabase({ documents });
  const res = response();
  await portalSummaryHandler(request({ query: { client_id: OTHER_CLIENT } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.documents[0].title, "Bank statement");
  const clientRead = calls.find((call) => /SELECT id, custom_fields FROM clients/i.test(call.sql));
  const documentRead = calls.find((call) => /FROM documents/i.test(call.sql));
  assert.deepEqual(clientRead.params, [CLIENT, ORG]);
  assert.deepEqual(documentRead.params, [ORG, CLIENT]);
});

test("simplify routes are registered to their actual handlers", () => {
  const routes = text("netlify/functions/api.mjs");
  assert.match(routes, /"client-notes": clientNotes/);
  assert.match(routes, /"commission-rules": commissionRules/);
  assert.match(routes, /"read\/bank-inbox": readBankInbox/);
});

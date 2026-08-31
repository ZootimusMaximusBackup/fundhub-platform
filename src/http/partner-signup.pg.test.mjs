// The white-label signup walk, end to end, against a real Postgres.
//
// WHAT THIS EXISTS TO CATCH. The end-to-end audit of 2026-08-27
// (docs/workflows/full-e2e-audit-2026-08-27.md, White-label lane) recorded a
// partner who applied, could sign in, and had a working branded site — while:
//
//   * Pipeline R-08 showed 0 cards, in every stage, for every partner;
//   * CRM search returned nothing for the person's name or their company;
//   * zero welcome email and zero welcome text were ever written; and
//   * the events table held nothing at all for the whole journey.
//
// Every one of those is asserted below, on the code path a real request takes:
// the ROUTES map from netlify/functions/api.mjs, not a handler imported by hand,
// because "a handler file is not a route" has shipped broken twice (CLAUDE.md
// §12).
//
// SKIPS unless DATABASE_URL is set. It does NOT pass quietly — every test in the
// file carries the same skip, so an unset database reads as skipped, not green.

import { test, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, close } from "../db.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { createAccountSession } from "../auth/account-session.mjs";
import partnerApply from "../../api/public/partner-apply.mjs";
import readPartners from "../../api/read/partners.mjs";
import readSearch from "../../api/read/search.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");

const STAMP = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const PERSON = `Wlsim Personname ${STAMP}`;
const COMPANY = `Wlsim Company ${STAMP}`;
const EMAIL = `wl-signup-${STAMP}@example.test`;
const PHONE = "6615550100";

const QUIET_PERSON = `Wlquiet Personname ${STAMP}`;
const QUIET_EMAIL = `wl-quiet-${STAMP}@example.test`;

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const call = async (handler, req) => {
  const res = makeRes();
  await handler(req, res);
  return res;
};

const applyBody = (over = {}) => ({
  name: PERSON,
  email: EMAIL,
  phone: PHONE,
  company: COMPANY,
  audience: "I speak to small business owners every week.",
  track: "white_label",
  sms_consent: true,
  ...over
});

let orgId = null;
let ownerToken = null;
let closerToken = null;
let partnerId = null;
let quietPartnerId = null;
let strandedPartnerId = null;
const staffIds = [];

before(async () => {
  if (!HAS_DB) return;
  orgId = await resolveDefaultOrg(db);

  const owner = (await db.query(
    `INSERT INTO staff (org_id, name, email, role, status)
     VALUES ($1, $2, $3, 'owner', 'active') RETURNING id`,
    [orgId, "WL Signup Owner", `wl-owner-${STAMP}@example.test`]
  )).rows[0];
  const closer = (await db.query(
    `INSERT INTO staff (org_id, name, email, role, status)
     VALUES ($1, $2, $3, 'closer', 'active') RETURNING id`,
    [orgId, "WL Signup Closer", `wl-closer-${STAMP}@example.test`]
  )).rows[0];
  staffIds.push(owner.id, closer.id);

  ownerToken = (await createSession(db, { staffId: owner.id, orgId })).token;
  closerToken = (await createSession(db, { staffId: closer.id, orgId })).token;
});

after(async () => {
  if (!HAS_DB) return;
  const ids = [partnerId, quietPartnerId, strandedPartnerId].filter(Boolean);
  try {
    await db.query(
      `DELETE FROM messages WHERE org_id = $1 AND provider_ref = ANY($2::text[])`,
      [orgId, ids.flatMap((id) => [`partner:${id}:welcome:email`, `partner:${id}:welcome:sms`])]
    );
    await db.query(`DELETE FROM events WHERE org_id = $1 AND idempotency_key = ANY($2::text[])`,
      [orgId, ids.map((id) => `partner.approved:${id}`)]);
    await db.query(`DELETE FROM cards WHERE partner_id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM partner_pages WHERE partner_id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM partner_brand WHERE partner_id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM account_sessions WHERE account_id IN
      (SELECT id FROM accounts WHERE partner_id = ANY($1::uuid[]))`, [ids]);
    await db.query(`DELETE FROM accounts WHERE partner_id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM partners WHERE id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM sessions WHERE staff_id = ANY($1::uuid[])`, [staffIds]);
    await db.query(`DELETE FROM staff WHERE id = ANY($1::uuid[])`, [staffIds]);
  } catch { /* best effort — a leftover sim row must not red the suite */ }
  await close();
});

/* ── The application ────────────────────────────────────────────────────── */

test("a white-label application boards a named card on R-08 at Invited",
  { skip: !HAS_DB }, async () => {
    const res = await call(partnerApply, { method: "POST", headers: {}, body: applyBody() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.kind, "partner");
    assert.equal(res.body.status, "pending_review");
    partnerId = res.body.partner_id;
    assert.ok(partnerId, "the application must return the partner it created");

    const partner = (await db.query(
      `SELECT status, name, contact_email FROM partners WHERE id = $1`, [partnerId]
    )).rows[0];
    assert.equal(partner.status, "invited");
    assert.equal(partner.name, COMPANY);

    const card = (await db.query(
      `SELECT s.key AS stage, p.key AS pipeline
         FROM cards c
         JOIN pipelines p ON p.id = c.pipeline_id
         JOIN pipeline_stages s ON s.id = c.stage_id
        WHERE c.partner_id = $1`, [partnerId]
    )).rows;
    assert.equal(card.length, 1, "R-08 must carry exactly one card for the applicant");
    assert.equal(card[0].pipeline, "affiliates_white_label");
    assert.equal(card[0].stage, "invited");
  });

test("an application is not a login — nothing is provisioned before a human looks",
  { skip: !HAS_DB }, async () => {
    const accounts = (await db.query(
      `SELECT id FROM accounts WHERE org_id = $1 AND lower(email) = $2`, [orgId, EMAIL]
    )).rows;
    assert.equal(accounts.length, 0, "an applicant must not be handed a login");
    const pages = (await db.query(
      `SELECT id FROM partner_pages WHERE partner_id = $1`, [partnerId]
    )).rows;
    assert.equal(pages.length, 0, "an applicant must not have a published page");
  });

/* ── The CRM can find them ──────────────────────────────────────────────── */

async function search(token, q) {
  const res = await call(readSearch, {
    method: "GET", headers: { authorization: `Bearer ${token}` }, query: { q }
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.groups;
}

test("CRM search finds a white-label applicant by their company",
  { skip: !HAS_DB }, async () => {
    const groups = await search(ownerToken, COMPANY);
    assert.equal(groups.cards.length, 1, "the company name must return the R-08 card");
    assert.equal(groups.cards[0].title, COMPANY);
    assert.match(groups.cards[0].subtitle, /Invited/);
  });

test("CRM search finds a white-label applicant by the PERSON's name",
  { skip: !HAS_DB }, async () => {
    // The human's name is on no column of `partners` — the form keeps it in
    // notes as `contact=`. Searching only name/brand/email/accounts returns
    // nothing here, which is what the 2026-08-27 walk recorded.
    const groups = await search(ownerToken, PERSON);
    assert.equal(groups.cards.length, 1, "the applicant's own name must find their card");
    assert.equal(groups.cards[0].title, COMPANY);
  });

/* ── Approval: the step that had no door ────────────────────────────────── */

test("POST /api/partners/approve is a real route, not just a file",
  { skip: !HAS_DB }, () => {
    assert.equal(typeof ROUTES["partners/approve"], "function",
      "an approval handler absent from the ROUTES map 404s locally and deployed");
  });

test("approval is owner/admin only, and refuses a stranger outright",
  { skip: !HAS_DB }, async () => {
    const approve = ROUTES["partners/approve"];
    const anon = await call(approve, { method: "POST", headers: {}, body: { partner_id: partnerId } });
    assert.equal(anon.statusCode, 401);

    const closer = await call(approve, {
      method: "POST",
      headers: { authorization: `Bearer ${closerToken}` },
      body: { partner_id: partnerId }
    });
    assert.equal(closer.statusCode, 403, "a closer must not be able to mint a partner login");

    const stillInvited = (await db.query(
      `SELECT status FROM partners WHERE id = $1`, [partnerId]
    )).rows[0];
    assert.equal(stillInvited.status, "invited", "a refused approval must change nothing");
  });

test("approval mints the login, publishes the page and moves the card to Active",
  { skip: !HAS_DB }, async () => {
    const res = await call(ROUTES["partners/approve"], {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
      body: { partner_id: partnerId }
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "active");
    assert.ok(res.body.password, "the first password comes back once, to the approver");
    assert.equal(res.body.site_path, `/sites/${partnerId}/apply`);

    // Approval supplies status only. The payout gate (042_partners.sql) needs
    // agreement_signed_at too, and signing stays a separate human act.
    assert.equal(res.body.agreement_signed, false);
    const row = (await db.query(
      `SELECT status, agreement_signed_at FROM partners WHERE id = $1`, [partnerId]
    )).rows[0];
    assert.equal(row.status, "active");
    assert.equal(row.agreement_signed_at, null);

    const account = (await db.query(
      `SELECT id, kind, partner_id FROM accounts WHERE org_id = $1 AND lower(email) = $2`,
      [orgId, EMAIL]
    )).rows[0];
    assert.ok(account, "approval is what creates the login");
    assert.equal(account.kind, "partner");
    assert.equal(account.partner_id, partnerId);

    const page = (await db.query(
      `SELECT status FROM partner_pages WHERE partner_id = $1 AND slug = 'apply'`, [partnerId]
    )).rows[0];
    assert.equal(page.status, "published");

    const stage = (await db.query(
      `SELECT s.key FROM cards c JOIN pipeline_stages s ON s.id = c.stage_id
        WHERE c.partner_id = $1`, [partnerId]
    )).rows[0];
    assert.equal(stage.key, "active", "the R-08 card follows the partner's status");
  });

test("approval writes the welcome email and, on a ticked box, the welcome text",
  { skip: !HAS_DB }, async () => {
    const rows = (await db.query(
      `SELECT channel, template_key, status, to_address
         FROM messages WHERE org_id = $1 AND provider_ref LIKE $2
        ORDER BY channel`,
      [orgId, `partner:${partnerId}:welcome:%`]
    )).rows;
    const byChannel = Object.fromEntries(rows.map((r) => [r.channel, r]));
    assert.ok(byChannel.email, "a partner who is approved must be told so");
    assert.equal(byChannel.email.template_key, "EMAIL-PARTNER-WELCOME");
    assert.equal(byChannel.email.to_address, EMAIL);
    assert.ok(byChannel.sms, "the applicant ticked the text box, so a text is queued");
    assert.equal(byChannel.sms.template_key, "SMS-PARTNER-WELCOME");
    assert.equal(byChannel.sms.to_address, "+16615550100",
      "the number is taken from the application, in E.164");
  });

test("the welcome copy does not point at a password the partner never saw",
  { skip: !HAS_DB }, async () => {
    const body = (await db.query(
      `SELECT rendered_body FROM messages
        WHERE org_id = $1 AND provider_ref = $2`,
      [orgId, `partner:${partnerId}:welcome:email`]
    )).rows[0].rendered_body;
    assert.ok(!/password from the screen/i.test(body),
      "invite-only signup has no screen where a password was shown");
    assert.match(body, /Forgot your password/i,
      "the mail must name the door that actually sets their password");
  });

test("approval writes partner.approved on the event bus, exactly once",
  { skip: !HAS_DB }, async () => {
    const first = (await db.query(
      `SELECT id, name, payload FROM events
        WHERE org_id = $1 AND idempotency_key = $2`,
      [orgId, `partner.approved:${partnerId}`]
    )).rows;
    assert.equal(first.length, 1, "the journey must leave a trace on the event log");
    assert.equal(first[0].name, "partner.approved");
    assert.equal(first[0].payload.partnerId, partnerId);

    // Approving twice is a double click, not a second partner.
    const again = await call(ROUTES["partners/approve"], {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
      body: { partner_id: partnerId }
    });
    assert.equal(again.statusCode, 200);
    const after2 = (await db.query(
      `SELECT count(*)::int AS n FROM events
        WHERE org_id = $1 AND idempotency_key = $2`,
      [orgId, `partner.approved:${partnerId}`]
    )).rows[0].n;
    assert.equal(after2, 1, "a repeat approval must not write a second event");
    const cards = (await db.query(
      `SELECT count(*)::int AS n FROM cards WHERE partner_id = $1`, [partnerId]
    )).rows[0].n;
    assert.equal(cards, 1, "a repeat approval must not board a second card");
  });

/* ── The partner signs in ───────────────────────────────────────────────── */

test("the approved partner signs in and Partner Home counts them",
  { skip: !HAS_DB }, async () => {
    const account = (await db.query(
      `SELECT id FROM accounts WHERE org_id = $1 AND lower(email) = $2`, [orgId, EMAIL]
    )).rows[0];
    const { token } = await createAccountSession(db, { accountId: account.id, orgId });

    const res = await call(readPartners, {
      method: "GET", headers: { authorization: `Bearer ${token}` }, query: {}
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.items.length, 1,
      "a signed-in partner must not be told there are no partners on file");
    assert.equal(res.body.items[0].id, partnerId);
    // Their own row only — never the rest of the roster.
    assert.equal(res.body.items[0].name, COMPANY);
  });

/* ── Consent ────────────────────────────────────────────────────────────── */

test("an applicant who left the text box unticked is emailed and never texted",
  { skip: !HAS_DB }, async () => {
    const applied = await call(partnerApply, {
      method: "POST", headers: {},
      body: applyBody({ name: QUIET_PERSON, email: QUIET_EMAIL, sms_consent: false })
    });
    assert.equal(applied.statusCode, 200, JSON.stringify(applied.body));
    quietPartnerId = applied.body.partner_id;

    const res = await call(ROUTES["partners/approve"], {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
      body: {
        partner_id: quietPartnerId,
        // Ignored on purpose: consent belongs to the applicant, not the approver.
        phone: "+16615550199",
        sms_consent: true
      }
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const channels = (await db.query(
      `SELECT channel FROM messages WHERE org_id = $1 AND provider_ref LIKE $2`,
      [orgId, `partner:${quietPartnerId}:welcome:%`]
    )).rows.map((r) => r.channel);
    assert.deepEqual(channels, ["email"],
      "an approver must not be able to consent on somebody else's behalf");
  });

/* ── The partners who were already on file ──────────────────────────────── */

test("migration 274 boards a partner who existed before the rail carried cards",
  { skip: !HAS_DB }, async () => {
    const row = (await db.query(
      `INSERT INTO partners (org_id, name, brand_name, slug, status, contact_email)
       VALUES ($1, $2, $2, $3, 'active', $4) RETURNING id`,
      [orgId, `Wlold Company ${STAMP}`, `wlold-company-${STAMP}`, `wl-old-${STAMP}@example.test`]
    )).rows[0];
    strandedPartnerId = row.id;

    const before = (await db.query(
      `SELECT count(*)::int AS n FROM cards WHERE partner_id = $1`, [strandedPartnerId]
    )).rows[0].n;
    assert.equal(before, 0, "nothing boards a partner that did not come through the form");

    const sql = fs.readFileSync(
      path.join(REPO, "db/migrations/274_partner_rail_backfill.sql"), "utf8");
    await db.query(sql);

    const stage = (await db.query(
      `SELECT s.key FROM cards c JOIN pipeline_stages s ON s.id = c.stage_id
        WHERE c.partner_id = $1`, [strandedPartnerId]
    )).rows;
    assert.equal(stage.length, 1, "the backfill must board them exactly once");
    assert.equal(stage[0].key, "active", "on the stage matching the status they already have");

    // Idempotent: running it twice does not double-board anyone.
    await db.query(sql);
    const again = (await db.query(
      `SELECT count(*)::int AS n FROM cards WHERE partner_id = $1`, [strandedPartnerId]
    )).rows[0].n;
    assert.equal(again, 1);

    // And now search can see them, which is the point of boarding them at all.
    const groups = await search(ownerToken, `Wlold Company ${STAMP}`);
    assert.equal(groups.cards.length, 1);
  });

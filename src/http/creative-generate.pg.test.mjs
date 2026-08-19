// Postgres-backed tests for POST /api/creative/generate — the endpoint the
// "Enqueue generation" button on Creative Factory actually calls.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**/*.test.mjs" and "scripts/**/*.test.mjs"; a test placed in api/
// is never collected and passes forever by never running. The handler is
// imported from here instead — the same arrangement, and the same reason, as
// src/http/finance-soft-pull.pg.test.mjs.
//
// THE BUG THIS EXISTS TO CATCH, and why the module-level tests could not.
//
// src/creative/generate.pg.test.mjs exercises enqueue() directly and passes
// whatever requester it likes, so it never met the one the HTTP path supplies.
// The handler used to send `principal.staffId` into a column declared
// `requested_by uuid REFERENCES accounts(id)`. A staff id lives in `staff`, a
// different table with its own independently generated primary key, so every
// enqueue from an owner or admin session raised a foreign key violation and the
// screen showed a 500. A partner session has no staffId at all, wrote NULL, and
// looked fine — which is why the fault only ever reproduced for staff, and why a
// test that only ever signs in as a partner would still be green today.
//
// SO THE ASSERTIONS ARE AGAINST generation_jobs, NOT AGAINST THE RESPONSE. A
// response is the endpoint's account of what it did; the row is what it did, and
// the row is the thing the foreign key refused to accept.
//
// THE READS RUN INSIDE asStaff(). generation_jobs is row-level-secured, so an
// unscoped SELECT matches nothing and reports success — a test asserting on an
// unscoped read would find zero rows and could not tell "refused" from "hidden".
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { asStaff } from "../partners/rls.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { createAccountSession } from "../auth/account-session.mjs";
import handler from "../../api/creative/generate.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const PARTNER_SLUG = "cfgen-http-test-partner";
const STAFF_EMAIL_LIKE = "cfgen_http_test_%@example.com";
const ACCT_EMAIL_LIKE = "cfgen_http_acct_%@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/creative/generate", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, partnerId;
  let ownerStaff, ownerToken, partnerAccountId, partnerToken;

  /* The handler runs the real requirePrincipal against the real sessions and
     account_sessions tables, so every call below carries a token minted for a
     real row. There is no injection seam, deliberately. */
  const call = async (body, token) => {
    const r = res();
    await handler({
      method: "POST", query: {}, body,
      headers: token ? { authorization: "Bearer " + token } : {}
    }, r);
    return r;
  };

  const jobRow = async (idem) => (await asStaff((tx) => tx.query(
    `SELECT * FROM generation_jobs WHERE partner_id = $1 AND idempotency_key = $2`,
    [partnerId, idem]
  ))).rows[0];

  async function purge() {
    const ids = (await db.query(
      `SELECT id FROM partners WHERE slug = $1`, [PARTNER_SLUG])).rows.map((r) => r.id);
    if (ids.length) {
      await asStaff(async (tx) => {
        for (const t of ["generation_job_assets", "generation_jobs",
                         "partner_ai_usage", "partner_module_settings"]) {
          await tx.query(`DELETE FROM ${t} WHERE partner_id = ANY($1)`, [ids]);
        }
      });
      // accounts.partner_id is ON DELETE CASCADE, so the partner delete takes the
      // fixture account and its sessions with it.
      await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [ACCT_EMAIL_LIKE]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();

    partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,'CFGen Http Test',$2,'active',now()) RETURNING id`,
      [org, PARTNER_SLUG])).rows[0].id;

    // The suite switch is what assertSuiteEnabled() reads. Off, and the endpoint
    // answers 403 before it ever reaches the insert this file is about.
    await asStaff((tx) => tx.query(
      `INSERT INTO partner_module_settings
         (org_id, partner_id, approve_before_launch, max_concurrent_jobs, marketing_suite_enabled)
       VALUES ($1,$2,true,2,true) ON CONFLICT (partner_id) DO NOTHING`, [org, partnerId]));

    ownerStaff = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'CFGen Httptest Owner','owner',$2,'active') RETURNING id`,
      [org, "cfgen_http_test_owner@example.com"])).rows[0].id;
    ownerToken = (await createSession(db, { staffId: ownerStaff, orgId: org })).token;

    // 044's accounts_active_needs_hash needs a hash on an active account, and its
    // trigger refuses a self-signed-up partner, so invited_by names the employee
    // who invited them. This account signs in through createAccountSession
    // directly, so the hash is a placeholder no test authenticates against.
    partnerAccountId = (await db.query(
      `INSERT INTO accounts
         (org_id, kind, email, name, status, partner_id, password_hash, invited_by, invited_at)
       VALUES ($1,'partner',$2,'CFGen Acct','active',$3,'scrypt$placeholder',$4,now()) RETURNING id`,
      [org, "cfgen_http_acct_partner@example.com", partnerId, ownerStaff])).rows[0].id;
    partnerToken = (await createAccountSession(db, { accountId: partnerAccountId, orgId: org })).token;
  });

  after(async () => { await purge(); await close(); });

  // ---------------------------------------------------------------- the bug

  test("an owner's enqueue is accepted and the job records the owner as the requester", async () => {
    const idem = "cfgen-staff-1";
    const r = await call({
      partner_id: partnerId, asset_kind: "static", idempotency_key: idem,
      prompt: "Working capital for owners"
    }, ownerToken);

    // Before 241 this was a 500: the staff id was written into a column that
    // references accounts(id), and Postgres refused it.
    assert.strictEqual(r.code, 200, `expected 200, got ${r.code} — ${JSON.stringify(r.body)}`);
    assert.strictEqual(r.body.ok, true);
    assert.strictEqual(r.body.created, true);

    const row = await jobRow(idem);
    assert.ok(row, "the job row must exist — a 200 with no row is the failure this file exists to catch");
    assert.strictEqual(row.status, "queued");
    assert.strictEqual(row.requested_by_kind, "staff");
    assert.strictEqual(row.requested_by_staff_id, ownerStaff);
    assert.strictEqual(row.requested_by_account_id, null);
    // The superseded column is never written again. NULL means unknown, and it
    // stays unknown rather than being filled with a placeholder.
    assert.strictEqual(row.requested_by, null);
  });

  test("a partner's enqueue records the partner account, not a staff id", async () => {
    const idem = "cfgen-partner-1";
    const r = await call({
      partner_id: partnerId, asset_kind: "static", idempotency_key: idem, prompt: "Same, as a partner"
    }, partnerToken);

    assert.strictEqual(r.code, 200, `expected 200, got ${r.code} — ${JSON.stringify(r.body)}`);
    const row = await jobRow(idem);
    assert.ok(row);
    assert.strictEqual(row.requested_by_kind, "partner");
    assert.strictEqual(row.requested_by_account_id, partnerAccountId);
    assert.strictEqual(row.requested_by_staff_id, null);
  });

  test("the database refuses a requester that disagrees with its kind", async () => {
    // The CHECK, not the module, is what makes a mis-attributed job impossible.
    // Written straight past the handler on purpose.
    await assert.rejects(
      () => asStaff((tx) => tx.query(
        `INSERT INTO generation_jobs
           (org_id, partner_id, requested_by_kind, requested_by_account_id, spec, idempotency_key)
         VALUES ($1,$2,'staff',$3,'{}'::jsonb,'cfgen-mismatch')`,
        [org, partnerId, partnerAccountId])),
      /generation_jobs_requester_ck/);
  });

  test("an unattributed job is still allowed, because the cron writes one", async () => {
    // 045 says NULL means a scheduled or agent-initiated batch. If the new CHECK
    // had copied 077's NOT NULL, the every-two-minutes runner would start failing.
    const id = await asStaff((tx) => tx.query(
      `INSERT INTO generation_jobs (org_id, partner_id, spec, idempotency_key)
       VALUES ($1,$2,'{}'::jsonb,'cfgen-nobody') RETURNING id`,
      [org, partnerId]).then((r) => r.rows[0].id));
    assert.ok(id);
  });

  // ---------------------------------------------------------------- the rest

  test("the same batch name twice makes one job, not two", async () => {
    const idem = "cfgen-staff-1";           // the first test already used this one
    const r = await call({
      partner_id: partnerId, asset_kind: "static", idempotency_key: idem, prompt: "again"
    }, ownerToken);
    assert.strictEqual(r.code, 200);
    assert.strictEqual(r.body.created, false);

    const n = (await asStaff((tx) => tx.query(
      `SELECT count(*)::int AS n FROM generation_jobs
        WHERE partner_id = $1 AND idempotency_key = $2`, [partnerId, idem]))).rows[0].n;
    assert.strictEqual(n, 1);
  });

  test("the answer says whether anything can actually run", async () => {
    const r = await call({
      partner_id: partnerId, asset_kind: "static", idempotency_key: "cfgen-note-1", prompt: "x"
    }, ownerToken);
    assert.strictEqual(r.code, 200);
    assert.strictEqual(typeof r.body.provider_ready, "boolean");
    // Whichever way the install is configured, the sentence must match the fact.
    // A queued job with no provider is a job that can only fail, and saying so is
    // the point — there is no creative_providers row in any migration or seed.
    if (r.body.provider_ready === false) {
      assert.match(r.body.note, /cannot run yet/i);
    } else {
      assert.match(r.body.note, /picked up|Run queued jobs now/i);
    }
    // Nothing internal leaks into a sentence the owner reads.
    assert.doesNotMatch(r.body.note, /creative_providers|generation_jobs|docs\/|env\b/i);
  });

  test("no session is refused before anything is written", async () => {
    const r = await call({
      partner_id: partnerId, asset_kind: "static", idempotency_key: "cfgen-anon-1"
    }, null);
    assert.ok(r.code === 401 || r.code === 403, `expected 401/403, got ${r.code}`);
    assert.strictEqual(await jobRow("cfgen-anon-1"), undefined);
  });

  test("a batch with no name is refused", async () => {
    const r = await call({ partner_id: partnerId, asset_kind: "static" }, ownerToken);
    assert.strictEqual(r.code, 400);
    assert.strictEqual(r.body.error, "idempotency_key_required");
  });
});

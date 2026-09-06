// Zoho Recruit connector against a real Postgres. Skipped without DATABASE_URL.
//
// No network: every call goes through an injected ctx.fetch that answers from
// fixtures, exactly as ./linkedin.mjs is built to allow.
//
// THE TESTS THAT MATTER HERE ARE THE ONES ABOUT LOSING PEOPLE. A connector that
// drops an applicant does not raise an error — it produces a quiet day, and a
// quiet day looks like a quiet day for weeks. So there is a case for each way that
// can happen: a second poll duplicating somebody, a second poll MISSING somebody,
// a record with no email vanishing instead of being recorded, a second page of
// results never being read, and a cursor that jumps forward over a failed run.
//
// The second group is the free-tier queue. Zoho's free edition allows one live job
// and we have four open reqs, so "post the second one" must refuse in a way a
// person can read — never throw, never silently no-op, and above all never replace
// a live job somebody is mid-hire on.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import { encryptToken } from "../adplatforms/tokens.mjs";
import { reviseBrief } from "./owner.mjs";
import {
  postJob, closeJob, syncCandidates, postingQueue, connectionFor, refreshIfNeeded,
  MODULE_JOB_OPENINGS, ASSOCIATE_MODULE
} from "./zoho.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TAG = "zohotest";

// A throwaway encryption key for this process only. Generated, never committed,
// and it protects nothing real — the tokens below are the string "fake".
process.env.AD_TOKEN_ENC_KEY ||= crypto.randomBytes(32).toString("base64");

const LOCATION = { city: "Phoenix", state: "AZ", country: "United States" };
const ZOHO_JOB_ID = `${TAG}-job-1`;

/* ─── the fake Zoho ─── */

/* A router, not a stub. It reads the method and path the connector actually built,
   so a wrong URL, a missing page parameter or a forgotten data[] wrapper fails
   here rather than passing and failing against the real API months later. */
/* Handed to transmit() as ctx.env so the outbound fence is explicitly down for
   tests that mean to exercise the send path. See the note on fakeZoho's return. */
const FENCE_OFF = Object.freeze({ ADAPTERS_DRY_RUN: "0" });

function fakeZoho({ jobId = ZOHO_JOB_ID, associate = [], search = [], onPost } = {}) {
  const calls = [];
  const pageOf = (records, page) => {
    // 200 is Zoho's per_page maximum, but the fixtures are small, so a "page" here
    // is one entry of the outer array: [[page1], [page2]].
    const pages = Array.isArray(records[0]) ? records : [records];
    const idx = page - 1;
    const data = pages[idx] || [];
    return { data, info: { per_page: 200, count: data.length, page, more_records: idx < pages.length - 1 } };
  };

  const fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || "GET";
    const page = Number(u.searchParams.get("page") || 1);
    calls.push({ url, method, page, body: opts.body ? JSON.parse(opts.body) : null });

    const ok = (json) => ({
      ok: true, status: 200, text: async () => JSON.stringify(json)
    });

    if (method === "POST" && u.pathname.endsWith(`/${MODULE_JOB_OPENINGS}`)) {
      if (onPost) return onPost(JSON.parse(opts.body));
      return ok({ data: [{ code: "SUCCESS", status: "success", details: { id: jobId } }] });
    }
    if (method === "PUT" && u.pathname.endsWith(`/${MODULE_JOB_OPENINGS}`)) {
      return ok({ data: [{ code: "SUCCESS", status: "success", details: { id: jobId } }] });
    }
    if (u.pathname.includes(`/${ASSOCIATE_MODULE}/`) && u.pathname.endsWith("/associate")) {
      return ok(pageOf(associate, page));
    }
    if (u.pathname.endsWith("/Candidates/search")) {
      return ok(pageOf(search, page));
    }
    return { ok: false, status: 404, text: async () => `no fixture for ${method} ${u.pathname}` };
  };

  /* THE FENCE IS TURNED OFF EXPLICITLY, AND THAT IS THE POINT.
     Every outbound call now goes through transmit() in src/lib/outbound-fetch.mjs,
     which holds anything whose fence flag is unset — an injected fetch does NOT
     bypass it, deliberately, so a test cannot send by accident. These tests DO
     want the send path exercised against the fixture above, so they say so out
     loud. Only the fake fetch above can be reached from here; the real network
     is not involved either way.
     The opposite case — fence up, nothing sent — is pinned separately in
     "the outbound fence holds a call when the flag is unset". */
  return { fetch, calls, env: FENCE_OFF };
}

const candidate = (n, over = {}) => ({
  id: `${TAG}-cand-${n}`,
  First_Name: "Pat",
  Last_Name: `Applicant${n}`,
  Email: `${TAG}-${n}@example.test`,
  Phone: "602-555-0100",
  City: "Phoenix",
  Experience_in_Years: 3,
  Candidate_Status: "New",
  Created_Time: "2026-09-05T08:00:00-07:00",
  Modified_Time: "2026-09-05T08:00:00-07:00",
  ...over
});

/* ─── the suite ─── */

describe("Zoho Recruit connector", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, roleId, secondRoleId;
  const roleKey = `${TAG}_req`;
  const secondRoleKey = `${TAG}_req_two`;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();

    // Throwaway reqs, so nothing here touches the seeded closer/setter rows.
    roleId = (await db.query(
      `INSERT INTO hiring_roles (org_id, key, name, bench_target)
       VALUES ($1, $2, 'Zoho Test Req', 1) RETURNING id`, [org, roleKey])).rows[0].id;
    secondRoleId = (await db.query(
      `INSERT INTO hiring_roles (org_id, key, name, bench_target)
       VALUES ($1, $2, 'Zoho Test Req Two', 1) RETURNING id`, [org, secondRoleKey])).rows[0].id;

    // reviseBrief is the ONLY write path for role_brief (294). Setting the column
    // directly would produce live text with no revision behind it.
    await reviseBrief(db, {
      orgId: org, roleKey, reason: "fixture for the Zoho connector test",
      byAgent: "zoho-pg-test",
      brief: "Close inbound funding calls. Phone-first, no cold outreach."
    });
    // secondRoleKey deliberately keeps a NULL brief — that is a test case.

    await connect();
  });

  after(async () => { await cleanup(); await close(); });

  async function connect({ maxActive = 1 } = {}) {
    await db.query(`DELETE FROM hiring_channel_connections WHERE org_id = $1 AND channel = 'zoho'`, [org]);
    await db.query(
      `INSERT INTO hiring_channel_connections
         (org_id, channel, external_account_id, encrypted_access_token,
          encrypted_refresh_token, token_expires_at, scopes, connection_state,
          api_domain, max_active_postings)
       VALUES ($1,'zoho',$2,$3,$4, now() + interval '50 minutes',
               $5::jsonb, 'active', 'https://www.zohoapis.com', $6)`,
      [org, `${TAG}-account`,
       encryptToken("fake-access-token", { partnerId: org }),
       encryptToken("fake-refresh-token", { partnerId: org }),
       JSON.stringify(["ZohoRecruit.modules.candidates.READ", "ZohoRecruit.search.READ"]),
       maxActive]);
  }

  async function cleanup() {
    await db.query(
      `DELETE FROM hiring_zoho_candidate_links
        WHERE org_id = $1 AND zoho_candidate_id LIKE $2`, [org, `${TAG}%`]);
    await db.query(
      `DELETE FROM candidate_applications
        WHERE org_id = $1 AND role_id IN (SELECT id FROM hiring_roles WHERE org_id = $1 AND key LIKE $2)`,
      [org, `${TAG}%`]);
    await db.query(`DELETE FROM candidates WHERE org_id = $1 AND email LIKE $2`, [org, `${TAG}%`]);
    await db.query(
      `DELETE FROM hiring_job_postings
        WHERE org_id = $1 AND role_id IN (SELECT id FROM hiring_roles WHERE org_id = $1 AND key LIKE $2)`,
      [org, `${TAG}%`]);
    // Brief revisions are append-only, and their trigger allows a DELETE only once
    // the parent role is gone (294). Deleting the role cascades them.
    await db.query(`DELETE FROM hiring_roles WHERE org_id = $1 AND key LIKE $2`, [org, `${TAG}%`]);
    await db.query(`DELETE FROM hiring_channel_connections WHERE org_id = $1 AND channel = 'zoho'`, [org]);
  }

  const clearPostings = () => db.query(
    `DELETE FROM hiring_job_postings WHERE org_id = $1 AND channel = 'zoho'`, [org]);

  const clearApplicants = async () => {
    await db.query(`DELETE FROM hiring_zoho_candidate_links WHERE org_id = $1 AND zoho_candidate_id LIKE $2`,
      [org, `${TAG}%`]);
    await db.query(
      `DELETE FROM candidate_applications WHERE org_id = $1 AND role_id IN ($2, $3)`,
      [org, roleId, secondRoleId]);
    await db.query(`DELETE FROM candidates WHERE org_id = $1 AND email LIKE $2`, [org, `${TAG}%`]);
  };

  // ─────────────────────── connection ───────────────────────

  test("an active connection is found, and a token that is still good is not refreshed", async () => {
    const conn = await connectionFor(db, { orgId: org });
    assert.equal(conn.channel, "zoho");

    // ctx.fetch throws: reaching the network here would mean we refresh a token
    // that has fifty minutes left, on every single poll.
    /* env is set so the fence is DOWN: this test proves refreshIfNeeded does not
       refresh a still-valid token. With the fence up it would pass because
       nothing transmits at all, which proves nothing. */
    const z = { env: FENCE_OFF, fetch: async () => { throw new Error("must not refresh a live token"); } };
    const same = await refreshIfNeeded(db, { orgId: org, ctx: z });
    assert.equal(same.id, conn.id);
  });

  test("a revoked connection is a clear sentence, not a null", async () => {
    await db.query(
      `UPDATE hiring_channel_connections SET connection_state = 'revoked'
        WHERE org_id = $1 AND channel = 'zoho'`, [org]);
    await assert.rejects(
      () => connectionFor(db, { orgId: org }),
      /complete the Zoho OAuth flow/);
    await db.query(
      `UPDATE hiring_channel_connections SET connection_state = 'active'
        WHERE org_id = $1 AND channel = 'zoho'`, [org]);
  });

  // ─────────────────────── posting ───────────────────────

  test("refuses to post a req with no written job description", async () => {
    await clearPostings();
    const z = fakeZoho();
    const out = await postJob(db, {
      orgId: org, roleKey: secondRoleKey, location: LOCATION, ctx: z
    });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_role_brief");
    // Nothing was sent. An invented description becomes something a real person is
    // judged against.
    assert.equal(z.calls.length, 0);
    // The intent is still visible rather than lost.
    assert.equal(out.posting.status, "draft");
  });

  test("refuses to post with no location", async () => {
    await clearPostings();
    const z = fakeZoho();
    const out = await postJob(db, { orgId: org, roleKey, location: {}, ctx: z });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_location");
    assert.equal(z.calls.length, 0);
  });

  test("posts a job and records Zoho's id against the req", async () => {
    await clearPostings();
    const z = fakeZoho();
    const out = await postJob(db, { orgId: org, roleKey, location: LOCATION, ctx: z });

    assert.equal(out.ok, true);
    assert.equal(out.zohoJobId, ZOHO_JOB_ID);
    assert.equal(out.posting.status, "posted");
    assert.equal(out.posting.external_id, ZOHO_JOB_ID);

    // The body Zoho requires: a data ARRAY, and the description is the human's
    // brief, not a generated one.
    const post = z.calls.find((c) => c.method === "POST");
    assert.ok(Array.isArray(post.body.data), "the create body must be wrapped in data[]");
    assert.equal(post.body.data[0].Job_Title, "Zoho Test Req");
    assert.match(post.body.data[0].Job_Description, /Close inbound funding calls/);
    assert.equal(post.body.data[0].Publish, true);
  });

  test("posting the same req twice does not create a second Zoho job", async () => {
    const z = fakeZoho();
    const out = await postJob(db, { orgId: org, roleKey, location: LOCATION, ctx: z });
    assert.equal(out.ok, true);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM hiring_job_postings
        WHERE org_id = $1 AND role_id = $2 AND channel = 'zoho' AND status <> 'closed'`,
      [org, roleId]);
    assert.equal(rows[0].n, 1);
  });

  test("REFUSES a second live job on the free tier, cleanly, and queues it", async () => {
    // The free edition allows one active job. Four reqs exist. This must be a
    // refusal a person can read — not an exception, not a silent no-op, and above
    // all not a swap that pulls a live advert out from under a candidate.
    await reviseBrief(db, {
      orgId: org, roleKey: secondRoleKey, reason: "second req needs a brief to reach the limit check",
      byAgent: "zoho-pg-test", brief: "Second throwaway req."
    });

    const z = fakeZoho();
    const out = await postJob(db, { orgId: org, roleKey: secondRoleKey, location: LOCATION, ctx: z });

    assert.equal(out.ok, false);
    assert.equal(out.reason, "active_job_limit");
    assert.match(out.message, /Zoho Test Req/);
    assert.equal(out.queued, true);
    assert.equal(z.calls.length, 0, "nothing may be sent when the slot is taken");

    // The live job is untouched.
    const live = await db.query(
      `SELECT external_id FROM hiring_job_postings
        WHERE org_id = $1 AND channel = 'zoho' AND status = 'posted'`, [org]);
    assert.equal(live.rows.length, 1);
    assert.equal(live.rows[0].external_id, ZOHO_JOB_ID);
  });

  test("the queue says which is live and which is waiting, in plain words", async () => {
    const rows = (await postingQueue(db, { orgId: org }))
      .filter((r) => r.role_key.startsWith(TAG));
    const live = rows.find((r) => r.status === "posted");
    const waiting = rows.find((r) => r.status === "draft");
    assert.equal(live.plain_status, "live on Zoho");
    assert.equal(waiting.plain_status, "waiting for the slot");
  });

  test("closing the live job frees the slot for the queued req", async () => {
    const posting = (await db.query(
      `SELECT id FROM hiring_job_postings
        WHERE org_id = $1 AND channel = 'zoho' AND status = 'posted'`, [org])).rows[0];

    const z = fakeZoho();
    const closed = await closeJob(db, { orgId: org, postingId: posting.id, ctx: z });
    assert.equal(closed.posting.status, "closed");
    assert.ok(closed.posting.closed_at);

    // Zoho is told, so the advert stops collecting applicants we no longer poll for.
    assert.ok(z.calls.some((c) => c.method === "PUT"));

    const z2 = fakeZoho({ jobId: `${TAG}-job-2` });
    const out = await postJob(db, { orgId: org, roleKey: secondRoleKey, location: LOCATION, ctx: z2 });
    assert.equal(out.ok, true);
    assert.equal(out.zohoJobId, `${TAG}-job-2`);

    await clearPostings();
  });

  test("a Zoho failure marks the posting failed and keeps the reason", async () => {
    await clearPostings();
    const z = fakeZoho({
      onPost: async () => ({
        ok: false, status: 400,
        text: async () => JSON.stringify({ code: "MANDATORY_NOT_FOUND", message: "required field not found" })
      })
    });
    const out = await postJob(db, { orgId: org, roleKey, location: LOCATION, ctx: z });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "zoho_error");
    assert.equal(out.posting.status, "failed");
    assert.match(out.posting.last_error, /MANDATORY_NOT_FOUND/);
    await clearPostings();
  });

  // ─────────────────────── the poll ───────────────────────

  async function postAndSync(fixture, { now } = {}) {
    const z = fakeZoho(fixture);
    return { z, summary: await syncCandidates(db, { orgId: org, ctx: z, now }) };
  }

  async function livePosting() {
    await clearPostings();
    const out = await postJob(db, { orgId: org, roleKey, location: LOCATION, ctx: fakeZoho() });
    assert.equal(out.ok, true);
    return out.posting;
  }

  test("an applicant becomes a candidate and an application, through apply()", async () => {
    await livePosting();
    await clearApplicants();

    const { summary } = await postAndSync({ associate: [candidate(1)] });
    assert.equal(summary.created, 1);
    assert.equal(summary.skipped, 0);

    const app = (await db.query(
      `SELECT a.*, c.email, c.full_name, c.source, s.key AS stage_key
         FROM candidate_applications a
         JOIN candidates c ON c.id = a.candidate_id
         JOIN pipeline_stages s ON s.id = a.stage_id
        WHERE a.org_id = $1 AND a.role_id = $2`, [org, roleId])).rows;

    assert.equal(app.length, 1);
    assert.equal(app[0].email, `${TAG}-1@example.test`);
    assert.equal(app[0].source, "zoho");
    assert.equal(app[0].status, "open");
    // Left where a human picks it up. Nothing about a Zoho applicant advances or
    // closes on its own.
    assert.equal(app[0].stage_key, "applied");
    assert.equal(app[0].external_application_id, `zoho:${TAG}-cand-1:${roleKey}`);
    // Zoho's own status never becomes one of ours.
    assert.equal(app[0].answers.candidate_status, undefined);
  });

  test("RUNNING IT TWICE CREATES NO DUPLICATES", async () => {
    // The whole ball game. A redelivered page, an overlapping window and a manual
    // re-run all land here.
    const before = await postAndSync({ associate: [candidate(1)] });
    assert.equal(before.summary.created, 0);
    assert.equal(before.summary.duplicates, 1);

    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM candidate_applications WHERE org_id = $1 AND role_id = $2`,
      [org, roleId]);
    assert.equal(rows[0].n, 1);

    const cands = await db.query(
      `SELECT count(*)::int AS n FROM candidates WHERE org_id = $1 AND email = $2`,
      [org, `${TAG}-1@example.test`]);
    assert.equal(cands.rows[0].n, 1);

    const links = await db.query(
      `SELECT count(*)::int AS n FROM hiring_zoho_candidate_links
        WHERE org_id = $1 AND zoho_candidate_id = $2`, [org, `${TAG}-cand-1`]);
    assert.equal(links.rows[0].n, 1, "the id map must hold one row per candidate per req");
  });

  test("the same person arriving from BOTH endpoints is still one application", async () => {
    // The poll reads the per-job list and the incremental search and unions them.
    // If that union leaked, every applicant would double on every run.
    const { summary } = await postAndSync({
      associate: [candidate(1)],
      search: [candidate(1)]
    });
    assert.equal(summary.created, 0);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM candidate_applications WHERE org_id = $1 AND role_id = $2`,
      [org, roleId]);
    assert.equal(rows[0].n, 1);
  });

  test("a candidate with no email is RECORDED as skipped, not silently dropped", async () => {
    // The most expensive failure this connector has. A mapping bug that loses the
    // email field would otherwise be indistinguishable from a quiet week.
    await clearApplicants();
    const { summary } = await postAndSync({
      associate: [candidate(2, { Email: null }), candidate(3, { First_Name: null, Last_Name: null })]
    });

    assert.equal(summary.created, 0);
    assert.equal(summary.skipped, 2);

    const { rows } = await db.query(
      `SELECT zoho_candidate_id, status, skip_reason, application_id
         FROM hiring_zoho_candidate_links
        WHERE org_id = $1 AND zoho_candidate_id LIKE $2 ORDER BY zoho_candidate_id`,
      [org, `${TAG}-cand-%`]);

    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, "skipped");
    assert.equal(rows[0].skip_reason, "missing_email");
    assert.equal(rows[0].application_id, null);
    assert.equal(rows[1].skip_reason, "missing_name");

    // And nobody was half-created.
    const cands = await db.query(
      `SELECT count(*)::int AS n FROM candidates WHERE org_id = $1 AND email LIKE $2`,
      [org, `${TAG}%`]);
    assert.equal(cands.rows[0].n, 0);
  });

  test("a skipped applicant that is later fixed in Zoho comes through on the next poll", async () => {
    // The reason skipped rows are upserted rather than final: the recruiter adds
    // the missing email in Zoho and the next run must pick the person up.
    const { summary } = await postAndSync({ associate: [candidate(2)] });
    assert.equal(summary.created, 1);

    const { rows } = await db.query(
      `SELECT status, skip_reason, application_id FROM hiring_zoho_candidate_links
        WHERE org_id = $1 AND zoho_candidate_id = $2`, [org, `${TAG}-cand-2`]);
    assert.equal(rows[0].status, "linked");
    assert.equal(rows[0].skip_reason, null);
    assert.ok(rows[0].application_id);
  });

  test("protected characteristics never land, and the drop is counted in the data", async () => {
    await clearApplicants();
    const { summary } = await postAndSync({
      associate: [candidate(4, {
        Date_of_Birth: "1988-02-02", Gender: "Male", Criminal_History: "None"
      })]
    });

    assert.equal(summary.created, 1);
    assert.ok(summary.protectedDropped >= 3);

    const app = (await db.query(
      `SELECT answers FROM candidate_applications a
         JOIN candidates c ON c.id = a.candidate_id
        WHERE a.org_id = $1 AND c.email = $2`, [org, `${TAG}-4@example.test`])).rows[0];
    const keys = Object.keys(app.answers).join(",").toLowerCase();
    assert.ok(!keys.includes("birth"));
    assert.ok(!keys.includes("gender"));
    assert.ok(!keys.includes("criminal"));

    const link = (await db.query(
      `SELECT protected_fields_dropped FROM hiring_zoho_candidate_links
        WHERE org_id = $1 AND zoho_candidate_id = $2`, [org, `${TAG}-cand-4`])).rows[0];
    assert.ok(link.protected_fields_dropped >= 3,
      "the count must be visible in the data, not only in a log line");
  });

  test("PAGE TWO IS READ — everybody past record 200 is not lost", async () => {
    await clearApplicants();
    const { z, summary } = await postAndSync({
      associate: [[candidate(10), candidate(11)], [candidate(12)]]
    });

    assert.equal(summary.created, 3, "a second page must be followed, not assumed empty");
    const pages = z.calls.filter((c) => c.url.includes("/associate")).map((c) => c.page);
    assert.deepEqual(pages, [1, 2]);
    assert.equal(summary.truncated, false);
  });

  test("an empty search (Zoho's 204) is a normal quiet poll, not a failure", async () => {
    await clearApplicants();
    const z = {
      env: FENCE_OFF,
      fetch: async (url) => url.includes("/associate")
        ? { ok: true, status: 200, text: async () => JSON.stringify({ data: [], info: { more_records: false } }) }
        : { ok: true, status: 204, text: async () => "" }
    };
    const summary = await syncCandidates(db, { orgId: org, ctx: z });
    assert.equal(summary.created, 0);
    assert.deepEqual(summary.errors, []);
    assert.ok(summary.cursorAdvancedTo, "a clean empty run still advances the cursor");
  });

  test("the outbound fence holds a call when the flag is unset, and says so", async () => {
    /* THE PRODUCTION DEFAULT. ADAPTERS_DRY_RUN unset means BLOCKED, so this is
       the state a fresh deploy is in until somebody sets it. The danger is not
       that nothing sends — that is the intent — it is that a held poll could
       look like a normal quiet one and hide a broken pipeline for weeks.
       So: it must NOT create anything, must NOT advance the cursor, and must
       leave a readable reason naming the flag. */
    await clearApplicants();
    let reached = false;
    const z = {
      env: {},                       // fence UP: the flag is absent
      fetch: async () => { reached = true; throw new Error("must not reach the network"); }
    };

    const summary = await syncCandidates(db, { orgId: org, ctx: z });

    assert.equal(reached, false, "the fence must hold the call before any fetch happens");
    assert.equal(summary.created, 0);
    assert.ok(summary.errors.length > 0, "a held run must report an error, not read as quiet");
    assert.match(JSON.stringify(summary.errors), /ADAPTERS_DRY_RUN/,
      "the reason must name the flag, so whoever reads it knows the one-line fix");
    assert.ok(!summary.cursorAdvancedTo,
      "a held run must NOT advance the cursor — doing so skips everyone who applied meanwhile");
  });

  // ─────────────────────── the cursor ───────────────────────

  test("the cursor advances only after a clean run", async () => {
    await clearApplicants();
    const now = new Date("2026-09-05T15:00:00.000Z");
    const { summary } = await postAndSync({ associate: [candidate(20)] }, { now });
    assert.equal(summary.cursorAdvancedTo, now.toISOString());

    const { rows } = await db.query(
      `SELECT sync_cursor FROM hiring_channel_connections WHERE org_id = $1 AND channel = 'zoho'`, [org]);
    assert.equal(new Date(rows[0].sync_cursor).toISOString(), now.toISOString());
  });

  test("a failed read leaves the cursor where it was", async () => {
    // Re-reading a thousand records costs a few API calls. Missing one costs a
    // hire, and nobody ever finds out.
    const before = (await db.query(
      `SELECT sync_cursor FROM hiring_channel_connections WHERE org_id = $1 AND channel = 'zoho'`,
      [org])).rows[0].sync_cursor;

    const z = {
      fetch: async (url) => url.includes("/associate")
        ? { ok: true, status: 200, text: async () => JSON.stringify({ data: [], info: { more_records: false } }) }
        : { ok: false, status: 500, text: async () => "Zoho is having a day" }
    };
    const summary = await syncCandidates(db, { orgId: org, ctx: z, now: new Date("2026-09-06T00:00:00.000Z") });

    assert.equal(summary.cursorAdvancedTo, null);
    assert.ok(summary.errors.length > 0);

    const after2 = (await db.query(
      `SELECT sync_cursor FROM hiring_channel_connections WHERE org_id = $1 AND channel = 'zoho'`,
      [org])).rows[0].sync_cursor;
    assert.equal(new Date(after2).toISOString(), new Date(before).toISOString());
  });

  test("the search window is sent as UTC with an explicit offset, pulled back by the overlap", async () => {
    // A bare local time here silently shifts the window by hours and nothing
    // errors. See docs/workflows/arizona-time-2026-08-28.md.
    const cursor = new Date("2026-09-05T15:00:00.000Z");
    await db.query(
      `UPDATE hiring_channel_connections SET sync_cursor = $2 WHERE org_id = $1 AND channel = 'zoho'`,
      [org, cursor.toISOString()]);

    const { z } = await postAndSync({});
    const search = z.calls.find((c) => c.url.includes("/Candidates/search"));
    const criteria = decodeURIComponent(new URL(search.url).searchParams.get("criteria"));
    assert.match(criteria, /Created_Time:greater_equal:/);
    assert.match(criteria, /2026-09-05T14:55:00\.000Z/,
      "the window must start before the cursor and carry an explicit offset");
  });

  // ─────────────────────── nothing is decided by software ───────────────────────

  test("no Zoho applicant is ever rejected, scored or advanced by this connector", async () => {
    await clearApplicants();
    await postAndSync({
      associate: [candidate(30, { Candidate_Status: "Rejected", Rating: "1" })]
    });

    const rows = (await db.query(
      `SELECT a.status, s.key AS stage_key,
              (SELECT count(*)::int FROM hiring_decisions d WHERE d.application_id = a.id) AS decisions,
              (SELECT count(*)::int FROM application_scores sc WHERE sc.application_id = a.id) AS scores
         FROM candidate_applications a
         JOIN pipeline_stages s ON s.id = a.stage_id
         JOIN candidates c ON c.id = a.candidate_id
        WHERE a.org_id = $1 AND c.email = $2`, [org, `${TAG}-30@example.test`])).rows;

    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "open");
    assert.equal(rows[0].stage_key, "applied");
    assert.equal(rows[0].decisions, 0, "software must never record a hiring decision");
    assert.equal(rows[0].scores, 0, "this connector does not score anybody");
  });

  test("the health view reports what a human needs to see", async () => {
    // Builds its own state rather than reading what an earlier test happened to
    // leave behind — a test that depends on run order is a test that will lie
    // once somebody adds a case above it.
    await clearApplicants();
    await postAndSync({
      associate: [
        candidate(40, { Date_of_Birth: "1988-02-02", Gender: "Male" }),
        candidate(41, { Email: null })
      ]
    });

    const { rows } = await db.query(
      `SELECT * FROM v_zoho_connector_health WHERE org_id = $1`, [org]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].connection_state, "active");
    assert.equal(rows[0].max_active_postings, 1);
    assert.ok(rows[0].live_postings >= 1, "a live job should be visible");
    assert.equal(rows[0].skipped_candidates, 1, "the applicant we could not use must be countable");
    assert.ok(rows[0].protected_fields_dropped >= 2, "the stripping must be visible without reading logs");
  });
});

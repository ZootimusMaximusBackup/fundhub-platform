// Every hiring read endpoint's SQL, executed for real.
//
// Skipped without DATABASE_URL.
//
// Same reasoning as src/http/creative-endpoints.pg.test.mjs: these files are thin,
// which makes them tempting to leave untested, but a mistyped column parses fine
// and fails when somebody opens the screen. Each fetchRows runs against real rows.
//
// The PII assertions are specific to this module. A hiring endpoint that leaked a
// protected characteristic would be handing over the one category of data the
// intake path goes out of its way never to store.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { apply, scoreApplication, advance, reject } from "./pipeline.mjs";
import { ROLE_SETS } from "../http/read-api.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TAG = "hireep";

const ENDPOINTS = [
  ["candidates",             "../../api/hiring/candidates.mjs", {}],
  ["candidates?state",       "../../api/hiring/candidates.mjs", { state: "applied" }],
  ["candidates?role",        "../../api/hiring/candidates.mjs", { role: "closer" }],
  ["candidates?flagged",     "../../api/hiring/candidates.mjs", { flagged: "1" }],
  ["bench",                  "../../api/hiring/bench.mjs",      {}],
  ["decisions",              "../../api/hiring/decisions.mjs",  {}],
  ["decisions?state=reject", "../../api/hiring/decisions.mjs",  { state: "reject" }],
  ["funnel",                 "../../api/hiring/funnel.mjs",     {}],
  ["funnel?role",            "../../api/hiring/funnel.mjs",     { role: "closer" }],
  ["postings",               "../../api/hiring/postings.mjs",   {}],
  ["postings?channel",       "../../api/hiring/postings.mjs",   { channel: "linkedin" }]
];

describe("hiring read endpoints", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, staffId, applicationId, rejectedId;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();
    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, email, role, status, active)
       VALUES ($1,$2,$3,'admin','active',true) RETURNING id`,
      [org, `${TAG} recruiter`, `${TAG}-rec@example.test`])).rows[0].id;

    await withTx(async (tx) => {
      const posting = (await tx.query(
        `INSERT INTO hiring_job_postings (org_id, role_id, channel, title, status, external_id, posted_at)
         SELECT $1, r.id, 'linkedin', 'Closer', 'posted', 'urn:li:job:1', now()
           FROM hiring_roles r WHERE r.org_id = $1 AND r.key = 'closer' RETURNING id`,
        [org])).rows[0].id;

      // One healthy application, scored and advanced.
      const good = await apply(tx, {
        orgId: org, roleKey: "closer", fullName: `${TAG} Good`, email: `${TAG}-good@example.test`,
        source: "referral", jobPostingId: posting,
        answers: { effort: "thorough", age: 44, ethnicity: "x" }
      });
      applicationId = good.application.id;
      await scoreApplication(tx, {
        orgId: org, applicationId, categoryScores: full(4) });
      await advance(tx, { orgId: org, applicationId, toStageKey: "one_on_one", decidedByStaffId: staffId });

      // One flagged application, so ?flagged=1 has something to return.
      const flagged = await apply(tx, {
        orgId: org, roleKey: "setter", fullName: `${TAG} Flagged`,
        email: `${TAG}-flag@example.test`, source: "job_board", answers: { effort: "x" } });
      await scoreApplication(tx, {
        orgId: org, applicationId: flagged.application.id,
        categoryScores: { ...full(3), honesty: 1 } });

      // One rejected, by a human with a reason, so the decisions endpoint has an
      // adverse decision to report.
      const bad = await apply(tx, {
        orgId: org, roleKey: "closer", fullName: `${TAG} Bad`,
        email: `${TAG}-bad@example.test`, source: "ads", answers: { effort: "no" } });
      rejectedId = bad.application.id;
      const { score } = await scoreApplication(tx, {
        orgId: org, applicationId: rejectedId, categoryScores: full(1) });
      await reject(tx, {
        orgId: org, applicationId: rejectedId, decidedByStaffId: staffId,
        reason: "no relevant experience", scoreId: score.id });
    });
  });
  after(async () => { await cleanup(); await close(); });

  for (const [name, mod, query] of ENDPOINTS) {
    test(`${name} — the SQL runs`, async () => {
      const { fetchRows } = await import(mod);
      const rows = await fetchRows(db, { limit: 50, offset: 0, query });
      assert.ok(Array.isArray(rows), `${name} should return rows`);
    });
  }

  test("the board carries the score, its flags AND its rubric version together", async () => {
    // A reviewer shown a bare number is the rubber-stamping an AEDT review looks
    // for, so the flags must travel with it.
    const { fetchRows } = await import("../../api/hiring/candidates.mjs");
    const rows = await fetchRows(db, { limit: 50, offset: 0, query: {} });
    const scored = rows.find((r) => r.average !== null);
    assert.ok(scored, "fixture should have a scored application");
    assert.ok(scored.flags !== undefined, "flags must accompany the score");
    assert.strictEqual(scored.rubric_version, 1);
    assert.match(scored.recommendation_status, /advisory/);
  });

  test("?flagged=1 returns the application the grader flagged", async () => {
    const { fetchRows } = await import("../../api/hiring/candidates.mjs");
    const rows = await fetchRows(db, { limit: 50, offset: 0, query: { flagged: "1" } });
    assert.ok(rows.length >= 1);
    for (const r of rows) {
      assert.ok((r.flags && r.flags.length > 0) || r.average === null,
        "the flagged view must only contain rows needing a human");
    }
  });

  test("NO endpoint returns a protected characteristic", async () => {
    // The intake path strips them before storage, so this is a second check that
    // nothing reconstructs or re-adds them on the way out.
    const forbidden = /(^|_)(age|race|ethnic|gender|sex|religio|disab|marital|pregnan|veteran|citizen)($|_)/i;
    for (const [name, mod, query] of ENDPOINTS) {
      const { fetchRows } = await import(mod);
      const rows = await fetchRows(db, { limit: 50, offset: 0, query });
      for (const row of rows) {
        for (const key of Object.keys(row)) {
          assert.ok(!forbidden.test(key), `${name} returned protected column "${key}"`);
        }
      }
      // And no protected VALUE smuggled through a jsonb blob.
      const json = JSON.stringify(rows);
      assert.ok(!/"age"\s*:/.test(json), `${name} leaked an age value`);
      assert.ok(!/"ethnicity"\s*:/.test(json), `${name} leaked an ethnicity value`);
    }
  });

  test("the decisions endpoint reports whether the human followed the machine", async () => {
    const { fetchRows } = await import("../../api/hiring/decisions.mjs");
    const rows = await fetchRows(db, { limit: 50, offset: 0, query: { state: "reject" } });
    const r = rows[0];
    assert.ok(r, "the fixture rejection should appear");
    assert.strictEqual(r.human_decided, true);
    assert.ok(r.reason, "an adverse decision must carry its reason");
    // Rejected on a review_likely_no recommendation → followed.
    assert.strictEqual(r.followed_recommendation, true);
  });

  test("the application detail shows the FULL score history, not just the latest", async () => {
    const { fetchRows } = await import("../../api/hiring/application.mjs");
    await withTx((tx) => scoreApplication(tx, {
      orgId: org, applicationId, categoryScores: full(2), scoredByStaffId: staffId }));

    const detail = await fetchRows(db, { query: { id: applicationId } });
    assert.ok(detail, "detail should resolve");
    assert.strictEqual(detail.scores.length, 2, "an override must not hide the original");
    assert.strictEqual(detail.scores[0].is_automated, true);
    assert.strictEqual(detail.scores[1].is_automated, false);
    assert.match(detail.scoring_notice, /advisory/);
    assert.ok(Array.isArray(detail.decisions) && detail.decisions.length >= 1);
  });

  test("application detail requires an id and 404s on an unknown one", async () => {
    const { fetchRows } = await import("../../api/hiring/application.mjs");
    await assert.rejects(() => fetchRows(db, { query: {} }), /id is required/);
    const missing = await fetchRows(db,
      { query: { id: "00000000-0000-4000-8000-000000000000" } });
    assert.strictEqual(missing, null);
  });

  test("hiring reads are gated to HIRING, not the whole staff set", async () => {
    // Applicant PII plus an AEDT scoring trail is not material a closer needs.
    assert.deepStrictEqual([...ROLE_SETS.HIRING].sort(), ["admin", "owner"]);
    for (const role of ["closer", "setter", "funding_advisor", "inquiry_specialist"]) {
      assert.strictEqual(ROLE_SETS.HIRING.has(role), false, `${role} must not read hiring`);
    }
  });

  const full = (n) => ({
    effort: n, honesty: n, income_goal_fit: n, relevant_experience: n,
    sales_inputs: n, work_history: n
  });

  async function withTx(fn) {
    const client = await (await import("../db.mjs")).pool().connect();
    try {
      await client.query("BEGIN");
      const out = await fn({ query: (sql, params) => client.query(sql, params) });
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { /* original error wins */ }
      throw e;
    } finally { client.release(); }
  }

  async function cleanup() {
    const ids = (await db.query(
      `SELECT id FROM candidates WHERE email LIKE $1`, [`${TAG}-%`])).rows.map((r) => r.id);
    for (const [t, trg] of [["application_scores", "trg_application_scores_no_delete"],
                            ["hiring_decisions", "trg_hiring_decisions_no_delete"]]) {
      await db.query(`ALTER TABLE ${t} DISABLE TRIGGER ${trg}`);
    }
    await db.query(`ALTER TABLE candidate_applications DISABLE TRIGGER trg_application_terminal`);
    if (ids.length) {
      const apps = (await db.query(
        `SELECT id FROM candidate_applications WHERE candidate_id = ANY($1)`, [ids])).rows.map((r) => r.id);
      if (apps.length) {
        await db.query(`DELETE FROM application_scores WHERE application_id = ANY($1)`, [apps]);
        await db.query(`DELETE FROM hiring_decisions WHERE application_id = ANY($1)`, [apps]);
        await db.query(`DELETE FROM candidate_applications WHERE id = ANY($1)`, [apps]);
      }
      await db.query(`DELETE FROM candidates WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM hiring_job_postings WHERE external_id = 'urn:li:job:1'`);
    await db.query(
      `DELETE FROM tasks WHERE source_workflow IN ('hiring-candidate-feedback','hiring-bench-monitor')`);
    await db.query(`ALTER TABLE candidate_applications ENABLE TRIGGER trg_application_terminal`);
    for (const [t, trg] of [["application_scores", "trg_application_scores_no_delete"],
                            ["hiring_decisions", "trg_hiring_decisions_no_delete"]]) {
      await db.query(`ALTER TABLE ${t} ENABLE TRIGGER ${trg}`);
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${TAG}-%`]);
  }
});

// Candidate outreach against a real Postgres.
//
// Skipped without DATABASE_URL.
//
// THE TESTS THAT MATTER HERE ARE THE ONES THAT PROVE WE STOP. A follow-up
// cadence with no exit is the thing that generates complaints, so there is a
// separate case for each exit — replied, booked, opted out, a human decided —
// and each one attacks the cadence at the point it would otherwise send.
//
// The second group is consent. An applicant who left the text box unticked must
// get email and nothing else, and that has to be true at the database (the
// CHECK on candidates) as well as in the code that picks a destination.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close, pool } from "../db.mjs";
import { apply, advance, stageIdFor } from "./pipeline.mjs";
import {
  CADENCE, ensureOutreach, runOutreach, queueStep, stopOutreach, stopReasonFor,
  recordCandidateReply, recordCandidateOptOut, sweepCandidateOutreach,
  smsTarget, emailTarget, outreachContext,
  OUTREACH_EMAIL_KEYS, OUTREACH_SMS_KEYS
} from "./outreach.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TAG = "outreachtest";
const BOOKING_URL = "https://example.test/outreachtest-book";

const email = (who) => `${TAG}-${who}@example.test`;

describe("candidate outreach", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, roleKey, roleId;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();

    // A throwaway req so nothing here mutates the seeded closer/setter rows,
    // and so the booking link can be set and unset freely.
    roleKey = `${TAG}_req`;
    roleId = (await db.query(
      `INSERT INTO hiring_roles (org_id, key, name, bench_target, interview_booking_url)
       VALUES ($1,$2,'Outreach fixture',1,$3) RETURNING id`,
      [org, roleKey, BOOKING_URL])).rows[0].id;
  });

  after(async () => { await cleanup(); await close(); });

  // ---------------------------------------------------------------- the schema

  test("consent cannot be true without a record of what was agreed to", async () => {
    const c = await mkCandidate("consentguard", { phone: "+15551230001" });
    // The boolean alone is not a consent record — 295's CHECK says so.
    await assert.rejects(
      () => db.query(`UPDATE candidates SET sms_consent = true WHERE id = $1`, [c.id]),
      /candidates_sms_consent_ck/,
      "a bare sms_consent=true must be refused");

    // With the wording and the instant it is accepted.
    await db.query(
      `UPDATE candidates SET sms_consent = true, sms_consent_at = now(), sms_consent_text = $2
        WHERE id = $1`,
      [c.id, "I agree to receive text messages about my application. Reply STOP to opt out."]);
    const back = (await db.query(`SELECT sms_consent FROM candidates WHERE id = $1`, [c.id])).rows[0];
    assert.strictEqual(back.sms_consent, true);
  });

  test("a booking link that is not an https URL is refused", async () => {
    await assert.rejects(
      () => db.query(
        `UPDATE hiring_roles SET interview_booking_url = $2 WHERE id = $1`,
        [roleId, "book with us"]),
      /hiring_roles_booking_url_ck/);
    // Put the good one back for the rest of the file.
    await db.query(`UPDATE hiring_roles SET interview_booking_url = $2 WHERE id = $1`,
      [roleId, BOOKING_URL]);
  });

  test("one cadence per application, however many times it is started", async () => {
    const { application } = await mkApplication("twice");
    const a = await ensureOutreach(db, { orgId: org, applicationId: application.id });
    const b = await ensureOutreach(db, { orgId: org, applicationId: application.id });
    assert.strictEqual(a.created, true);
    assert.strictEqual(b.created, false);
    assert.strictEqual(a.outreach.id, b.outreach.id);

    const n = (await db.query(
      `SELECT count(*)::int AS n FROM candidate_outreach WHERE application_id = $1`,
      [application.id])).rows[0].n;
    assert.strictEqual(n, 1);
  });

  test("a stopped cadence must say when and why", async () => {
    const { application, outreach } = await mkCadence("stopguard");
    await assert.rejects(
      () => db.query(
        `UPDATE candidate_outreach SET status = 'stopped' WHERE id = $1`, [outreach.id]),
      /candidate_outreach_stop_ck/,
      "a stop with no reason must be refused by the database, not just by the code");
    assert.ok(application.id);
  });

  // ------------------------------------------------------------------ consent

  test("no consent means email only — the text is not queued at all", async () => {
    const { application, candidate } = await mkCadence("nosms", { phone: "+15551230002" });
    assert.strictEqual(candidate.sms_consent, false, "false is the default");
    assert.strictEqual(smsTarget(candidate), null);

    const out = await runOutreach(db, { orgId: org, applicationId: application.id });
    assert.strictEqual(out.queued, 1, "one message, the email");

    const rows = await messagesFor(application.id);
    assert.deepStrictEqual(rows.map((r) => r.channel), ["email"]);
    assert.strictEqual(
      rows[0].template_key, CADENCE[0].emailKey);

    const why = out.result.skipped.find((s) => s.channel === "sms");
    assert.strictEqual(why.reason, "no_sms_consent");
  });

  test("consent plus a real number means both, and the text carries STOP wording", async () => {
    const { application } = await mkCadence("bothchannels", {
      phone: "+15551230003", smsConsent: true
    });
    const out = await runOutreach(db, { orgId: org, applicationId: application.id });
    assert.strictEqual(out.queued, 2);

    const rows = await messagesFor(application.id);
    assert.deepStrictEqual(rows.map((r) => r.channel).sort(), ["email", "sms"]);

    const sms = rows.find((r) => r.channel === "sms");
    assert.match(sms.rendered_body, /STOP/, "a text with no way out is the complaint");
    assert.strictEqual(sms.to_address, "+15551230003");
    assert.strictEqual(sms.client_id, null, "a candidate is not a client");

    const mail = rows.find((r) => r.channel === "email");
    assert.strictEqual(mail.status, "queued", "queued only — the dispatcher sends");
    assert.strictEqual(mail.provider, null, "nothing here picks a provider");
  });

  test("consent with an unusable number is email only, and says which problem it was", async () => {
    const { application, candidate } = await mkCadence("badnumber", {
      phone: "555", smsConsent: true
    });
    assert.strictEqual(smsTarget(candidate), null);
    const out = await runOutreach(db, { orgId: org, applicationId: application.id });
    const why = out.result.skipped.find((s) => s.channel === "sms");
    assert.strictEqual(why.reason, "no_textable_number",
      "an unticked box and a broken number are different problems");
    assert.strictEqual(out.queued, 1);
  });

  test("an opted-out channel is dropped even though consent was given", async () => {
    const { application, candidate } = await mkCadence("smsstop", {
      phone: "+15551230004", smsConsent: true
    });
    await recordCandidateOptOut(db, { orgId: org, candidateId: candidate.id, channel: "sms" });

    const out = await runOutreach(db, { orgId: org, applicationId: application.id });
    const rows = await messagesFor(application.id);
    assert.deepStrictEqual(rows.map((r) => r.channel), ["email"],
      "STOP on text must not stop the email they still want");
    assert.strictEqual(out.queued, 1);

    // And the cadence keeps running, because email is still wanted.
    const row = await cadenceRow(application.id);
    assert.strictEqual(row.status, "active");
  });

  test("opting out of everything stops the cadence", async () => {
    const { application, candidate } = await mkCadence("allstop", { phone: "+15551230005" });
    const res = await recordCandidateOptOut(db, { orgId: org, candidateId: candidate.id });
    assert.strictEqual(res.stopped, 1);

    const row = await cadenceRow(application.id);
    assert.strictEqual(row.status, "stopped");
    assert.strictEqual(row.stop_reason, "opted_out");

    const out = await runOutreach(db, { orgId: org, applicationId: application.id });
    assert.strictEqual(out.reason, "already_stopped");
    assert.strictEqual((await messagesFor(application.id)).length, 0, "nothing was queued");
  });

  // -------------------------------------------------------------- the exits

  test("a reply stops it, and the cadence does not send again", async () => {
    const { application } = await mkCadence("replied");
    await runOutreach(db, { orgId: org, applicationId: application.id });   // step 1 goes
    assert.strictEqual((await messagesFor(application.id)).length, 1);

    await recordCandidateReply(db, { orgId: org, applicationId: application.id });

    const row = await cadenceRow(application.id);
    assert.strictEqual(row.stop_reason, "replied");
    assert.ok(row.replied_at, "the instant is recorded, not just a flag");

    // Force it due and sweep. Nothing more may go out.
    await makeDue(application.id);
    await runOutreach(db, { orgId: org, applicationId: application.id });
    assert.strictEqual((await messagesFor(application.id)).length, 1);
  });

  test("a booked interview stops it", async () => {
    const { application } = await mkCadence("booked");
    const interview = (await db.query(
      `INSERT INTO hiring_interviews (org_id, role_id, kind, scheduled_for, status)
       VALUES ($1,$2,'group', now() + interval '2 days', 'scheduled') RETURNING id`,
      [org, roleId])).rows[0].id;
    await db.query(
      `INSERT INTO hiring_interview_attendees (org_id, interview_id, application_id)
       VALUES ($1,$2,$3)`, [org, interview, application.id]);

    const out = await runOutreach(db, { orgId: org, applicationId: application.id });
    assert.strictEqual(out.stopReason, "booked");
    assert.strictEqual((await messagesFor(application.id)).length, 0);
  });

  test("a cancelled interview is not a booking", async () => {
    const { application, outreach } = await mkCadence("cancelled");
    const interview = (await db.query(
      `INSERT INTO hiring_interviews (org_id, role_id, kind, scheduled_for, status)
       VALUES ($1,$2,'group', now() + interval '2 days', 'cancelled') RETURNING id`,
      [org, roleId])).rows[0].id;
    await db.query(
      `INSERT INTO hiring_interview_attendees (org_id, interview_id, application_id)
       VALUES ($1,$2,$3)`, [org, interview, application.id]);

    assert.strictEqual(await stopReasonFor(db, outreach), null,
      "somebody whose interview was cancelled still needs chasing");
    const out = await runOutreach(db, { orgId: org, applicationId: application.id });
    assert.strictEqual(out.reason, "sent");
  });

  test("a human moving the application stops the chasing", async () => {
    const { application } = await mkCadence("advanced");
    await withTx((tx) => advance(tx, {
      orgId: org, applicationId: application.id, toStageKey: "group_interview"
    }));

    const out = await runOutreach(db, { orgId: org, applicationId: application.id });
    assert.strictEqual(out.stopReason, "decided");
    assert.strictEqual((await messagesFor(application.id)).length, 0);

    // AND THE APPLICATION IS UNTOUCHED. Stopping follow-ups is not a decision.
    const app = (await db.query(
      `SELECT status FROM candidate_applications WHERE id = $1`, [application.id])).rows[0];
    assert.strictEqual(app.status, "open");
    const decisions = (await db.query(
      `SELECT decision FROM hiring_decisions WHERE application_id = $1`,
      [application.id])).rows.map((r) => r.decision);
    assert.deepStrictEqual(decisions, ["advance"],
      "the only decision row is the human advance — the cadence wrote none");
  });

  test("going cold never closes the application", async () => {
    const { application } = await mkCadence("cold");
    // Run the whole cadence out.
    for (let i = 0; i < CADENCE.length; i += 1) {
      await makeDue(application.id);
      await runOutreach(db, { orgId: org, applicationId: application.id });
    }
    const row = await cadenceRow(application.id);
    assert.strictEqual(row.status, "stopped");
    assert.strictEqual(row.stop_reason, "completed");
    assert.strictEqual(row.step, CADENCE.length);

    const app = (await db.query(
      `SELECT status, s.key AS stage_key
         FROM candidate_applications a JOIN pipeline_stages s ON s.id = a.stage_id
        WHERE a.id = $1`, [application.id])).rows[0];
    assert.strictEqual(app.status, "open", "no candidate is ever rejected by software");
    assert.strictEqual(app.stage_key, "applied");
    const n = (await db.query(
      `SELECT count(*)::int AS n FROM hiring_decisions WHERE application_id = $1`,
      [application.id])).rows[0].n;
    assert.strictEqual(n, 0);
  });

  // ---------------------------------------------------------------- the steps

  test("four steps, in order, one per pass, ten days apart", async () => {
    const { application } = await mkCadence("sequence");
    const sent = [];
    for (let i = 0; i < CADENCE.length; i += 1) {
      await makeDue(application.id);
      const out = await runOutreach(db, { orgId: org, applicationId: application.id });
      sent.push(out.step);
    }
    assert.deepStrictEqual(sent, [1, 2, 3, 4]);

    const keys = (await messagesFor(application.id)).map((r) => r.template_key);
    assert.deepStrictEqual(keys, CADENCE.map((s) => s.emailKey));

    // The gaps add up to the ten days the header claims.
    const total = CADENCE.reduce((a, s) => a + s.afterDays, 0);
    assert.strictEqual(total, 10);
  });

  test("running the same step twice queues one message, not two", async () => {
    const { application, outreach } = await mkCadence("idempotent");
    const a = await queueStep(db, { orgId: org, outreach, step: 1 });
    const b = await queueStep(db, { orgId: org, outreach, step: 1 });
    assert.strictEqual(a.queued, 1);
    assert.strictEqual(b.queued, 0);
    assert.strictEqual(b.skipped.find((s) => s.channel === "email").reason, "already_queued");
    assert.strictEqual((await messagesFor(application.id)).length, 1);
  });

  test("the copy carries the real name and the real link, and no empty tags", async () => {
    const { application } = await mkCadence("merged");
    await runOutreach(db, { orgId: org, applicationId: application.id });
    const mail = (await messagesFor(application.id))[0];

    assert.match(mail.rendered_body, /Outreach fixture/, "the req's own name");
    assert.match(mail.rendered_body, new RegExp(BOOKING_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(mail.subject, /Outreach fixture/);
    assert.doesNotMatch(mail.rendered_body, /\{\{/, "an unrendered tag would ship braces to a person");

    // AND IT INVENTS NOTHING ABOUT THE JOB. None of these exists in this repo.
    for (const word of [/\$\d/, /\bsalary\b/i, /\bcommission\b/i, /\bOTE\b/, /\bper hour\b/i]) {
      assert.doesNotMatch(mail.rendered_body, word,
        "the copy must not state terms of employment that nothing in this repo holds");
    }
  });

  test("no booking link means nothing is sent, and somebody is asked for one", async () => {
    const bareKey = `${TAG}_nolink`;
    await db.query(
      `INSERT INTO hiring_roles (org_id, key, name, bench_target, owner_role)
       VALUES ($1,$2,'No link fixture',1,'sales_manager')`, [org, bareKey]);
    const { application } = await mkCadence("nolink", { roleKey: bareKey });

    const out = await runOutreach(db, { orgId: org, applicationId: application.id });
    assert.strictEqual(out.reason, "no_booking_link");
    assert.strictEqual((await messagesFor(application.id)).length, 0,
      "a dead link is worse than the silence this cadence exists to fix");

    // The cadence is NOT burned down while somebody is being asked for a URL.
    const row = await cadenceRow(application.id);
    assert.strictEqual(row.step, 0);
    assert.strictEqual(row.status, "active");

    const task = (await db.query(
      `SELECT title, assignee_role FROM tasks
        WHERE org_id = $1 AND source_workflow = 'hiring-outreach-cadence'
          AND title LIKE '%No link fixture%'`, [org])).rows[0];
    assert.ok(task, "nobody would ever find out otherwise");
    assert.strictEqual(task.assignee_role, "sales_manager",
      "routed by the req's owner rule, not to a generic pile");

    const gap = (await db.query(
      `SELECT config FROM v_hiring_outreach_gaps WHERE org_id = $1 AND config LIKE $2`,
      [org, `%${bareKey}`])).rows[0];
    assert.ok(gap, "the gap has to be visible without reading code");
  });

  // ---------------------------------------------------------------- the sweep

  test("the sweep works only what is due, and is bounded", async () => {
    const made = [];
    for (const who of ["sweep1", "sweep2", "sweep3"]) {
      made.push((await mkCadence(who)).application.id);
    }
    // Park one in the future — it is not due.
    await db.query(
      `UPDATE candidate_outreach SET next_due_at = now() + interval '5 days'
        WHERE application_id = $1`, [made[2]]);

    const out = await sweepCandidateOutreach(db, { cap: 2 });
    assert.ok(out.ok);
    assert.ok(out.scanned <= 2, "the cap is a cap");
    assert.strictEqual((await messagesFor(made[2])).length, 0, "a future step did not go early");
  });

  test("a stop is one-way and keeps its first reason", async () => {
    const { application } = await mkCadence("firstreason");
    await stopOutreach(db, { orgId: org, applicationId: application.id, reason: "replied" });
    const again = await stopOutreach(db, { orgId: org, applicationId: application.id, reason: "manual" });
    assert.strictEqual(again.stopped, false);
    assert.strictEqual(again.reason, "replied");
  });

  // --------------------------------------------------------------- pure bits

  test("the template keys the gate needs are the ones the cadence uses", () => {
    assert.deepStrictEqual([...OUTREACH_EMAIL_KEYS], CADENCE.map((s) => s.emailKey));
    assert.deepStrictEqual([...OUTREACH_SMS_KEYS], CADENCE.map((s) => s.smsKey));
  });

  test("the merge context offers nothing the repo cannot fill", () => {
    const ctx = outreachContext({
      candidate: { full_name: "Dana  Reyes", email: "d@example.test" },
      role: { name: "Closer", interview_booking_url: BOOKING_URL }
    });
    assert.strictEqual(ctx.candidate.first_name, "Dana");
    assert.strictEqual(ctx.role.booking_url, BOOKING_URL);
    // No pay, no hours, no description. Nothing holds them.
    assert.deepStrictEqual(Object.keys(ctx).sort(), ["candidate", "role"]);
    assert.deepStrictEqual(Object.keys(ctx.role).sort(), ["booking_url", "name"]);
  });

  test("a nameless applicant still gets a readable greeting", () => {
    assert.strictEqual(outreachContext({ candidate: {} }).candidate.first_name, "there");
    assert.strictEqual(emailTarget({ email: "  A@B.TEST " }), "a@b.test");
    assert.strictEqual(emailTarget({ email: "not-an-address" }), null);
  });

  // --------------------------------------------------------------- fixtures

  async function mkCandidate(who, { phone = null, smsConsent = false } = {}) {
    const row = (await db.query(
      `INSERT INTO candidates (org_id, full_name, email, phone, source)
       VALUES ($1,$2,$3,$4,'inbound')
       ON CONFLICT (org_id, email) DO UPDATE SET phone = EXCLUDED.phone
       RETURNING *`,
      [org, `${TAG} ${who}`, email(who), phone])).rows[0];
    if (smsConsent) {
      return (await db.query(
        `UPDATE candidates SET sms_consent = true, sms_consent_at = now(), sms_consent_text = $2
          WHERE id = $1 RETURNING *`,
        [row.id, "I agree to receive text messages about my application. Reply STOP to opt out."]
      )).rows[0];
    }
    return row;
  }

  async function mkApplication(who, { phone = null, smsConsent = false, roleKey: rk = roleKey } = {}) {
    const candidate = await mkCandidate(who, { phone, smsConsent });
    const stage = await stageIdFor(db, { orgId: org, stageKey: "applied" });
    const role = (await db.query(
      `SELECT id FROM hiring_roles WHERE org_id = $1 AND key = $2`, [org, rk])).rows[0];
    const application = (await db.query(
      `INSERT INTO candidate_applications (org_id, candidate_id, role_id, stage_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [org, candidate.id, role.id, stage])).rows[0];
    return { candidate, application };
  }

  async function mkCadence(who, opts = {}) {
    const { candidate, application } = await mkApplication(who, opts);
    const { outreach } = await ensureOutreach(db, { orgId: org, applicationId: application.id });
    return { candidate, application, outreach };
  }

  const messagesFor = async (applicationId) => (await db.query(
    `SELECT * FROM messages WHERE provider_ref LIKE $1 ORDER BY provider_ref, channel`,
    [`candidate:${applicationId}:%`])).rows;

  const cadenceRow = async (applicationId) => (await db.query(
    `SELECT * FROM candidate_outreach WHERE application_id = $1`, [applicationId])).rows[0];

  const makeDue = (applicationId) => db.query(
    `UPDATE candidate_outreach SET next_due_at = now() - interval '1 minute'
      WHERE application_id = $1`, [applicationId]);

  async function withTx(fn) {
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      const out = await fn({ query: (sql, params) => client.query(sql, params) });
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { /* the original error matters */ }
      throw e;
    } finally { client.release(); }
  }

  async function cleanup() {
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      const ids = (await client.query(
        `SELECT id FROM candidates WHERE email LIKE $1`, [`${TAG}-%`])).rows.map((r) => r.id);
      await client.query(`ALTER TABLE hiring_decisions DISABLE TRIGGER trg_hiring_decisions_no_delete`);
      await client.query(`ALTER TABLE application_scores DISABLE TRIGGER trg_application_scores_no_delete`);
      if (ids.length) {
        const apps = (await client.query(
          `SELECT id FROM candidate_applications WHERE candidate_id = ANY($1)`, [ids]
        )).rows.map((r) => r.id);
        if (apps.length) {
          await client.query(`DELETE FROM messages WHERE provider_ref LIKE ANY($1)`,
            [apps.map((a) => `candidate:${a}:%`)]);
          await client.query(`DELETE FROM candidate_outreach WHERE application_id = ANY($1)`, [apps]);
          await client.query(`DELETE FROM hiring_interview_attendees WHERE application_id = ANY($1)`, [apps]);
          await client.query(`DELETE FROM application_scores WHERE application_id = ANY($1)`, [apps]);
          await client.query(`DELETE FROM hiring_decisions WHERE application_id = ANY($1)`, [apps]);
          await client.query(`DELETE FROM candidate_applications WHERE id = ANY($1)`, [apps]);
        }
        await client.query(`DELETE FROM candidates WHERE id = ANY($1)`, [ids]);
      }
      await client.query(`DELETE FROM hiring_interviews WHERE org_id = $1 AND role_id IN
        (SELECT id FROM hiring_roles WHERE org_id = $1 AND key LIKE $2)`, [org, `${TAG}%`]);
      await client.query(`DELETE FROM tasks WHERE source_workflow = 'hiring-outreach-cadence'`);
      await client.query(`DELETE FROM hiring_roles WHERE org_id = $1 AND key LIKE $2`, [org, `${TAG}%`]);
      await client.query(`ALTER TABLE application_scores ENABLE TRIGGER trg_application_scores_no_delete`);
      await client.query(`ALTER TABLE hiring_decisions ENABLE TRIGGER trg_hiring_decisions_no_delete`);
      await client.query("COMMIT");
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { /* the original error matters */ }
      throw e;
    } finally { client.release(); }
  }
});

// `apply` is imported so this file fails loudly if pipeline.mjs's inbound path
// is renamed out from under the cadence that is meant to follow it.
void apply;

// Stage progression, and the human gate on every adverse decision.
//
// THE DIVISION OF LABOUR, and it is the whole design:
//
//   ./grading.mjs  scores.   It cannot reject. It has no staff id to offer.
//   this module     decides.  Every adverse outcome requires a named human, and
//                             the database enforces it too (hiring_decisions
//                             CHECK + the terminal-status trigger in 051).
//
// So `reject()` takes decidedByStaffId as a REQUIRED argument and throws without
// one. That throw is redundant with the CHECK constraint on purpose: the constraint
// is the guarantee, and this is the error message that tells the caller what they
// forgot.
//
// ADVANCING IS ALSO LOGGED. Not because advancing is risky, but because an audit
// that only records rejections cannot answer the question a bias review actually
// asks — how differently were similar candidates treated. Both directions or
// neither.

import { grade } from "./grading.mjs";
import { createTask } from "../lib/create-task.mjs";
import { assigneeFor } from "./owner.mjs";

// The funnel from doc 10 and doc 11, in order. `rejected` and `withdrawn` are
// terminal and reachable from anywhere.
export const STAGES = Object.freeze([
  "applied", "screening", "group_interview", "one_on_one",
  "offer", "hired", "onboarding", "ramp", "performing"
]);
export const TERMINAL_STAGES = Object.freeze(["rejected", "withdrawn"]);

/* stageIdFor — resolve a stage key inside the hiring pipeline.
   Throws on an unknown key rather than defaulting: silently parking an
   application in the wrong stage is how a candidate is forgotten. */
export async function stageIdFor(tx, { orgId, stageKey }) {
  const { rows } = await tx.query(
    `SELECT s.id FROM pipeline_stages s
       JOIN pipelines p ON p.id = s.pipeline_id
      WHERE p.org_id = $1 AND p.key = 'hiring' AND s.key = $2`,
    [orgId, stageKey]);
  if (!rows[0]) throw new Error(`stageIdFor: no hiring stage "${stageKey}"`);
  return rows[0].id;
}

/* apply(tx, spec) → { candidate, application, score }

   The inbound path. Find-or-create the person, open an application, score it
   against the active rubric, and leave it in `applied` for a human to look at.
   Idempotent on (candidate, role) while an application is open, and on
   externalApplicationId when one is supplied — a webhook redelivery from LinkedIn
   must not create a second application. */
export async function apply(tx, {
  orgId, roleKey, fullName, email, phone = null,
  source = "inbound", sourceDetail = null, answers = {},
  discProfile = null, videoUrl = null, linkedinUrn = null,
  jobPostingId = null, externalApplicationId = null
} = {}) {
  if (!orgId) throw new Error("apply: orgId is required");
  if (!email || !fullName) throw new Error("apply: fullName and email are required");

  const role = (await tx.query(
    `SELECT id, key FROM hiring_roles WHERE org_id = $1 AND key = $2 AND active`,
    [orgId, roleKey])).rows[0];
  if (!role) throw new Error(`apply: no active hiring role "${roleKey}"`);

  // Redelivery guard, checked first so a retried webhook is cheap and side-effect
  // free.
  if (externalApplicationId) {
    const existing = await tx.query(
      `SELECT * FROM candidate_applications
        WHERE org_id = $1 AND external_application_id = $2`,
      [orgId, externalApplicationId]);
    if (existing.rows[0]) return { application: existing.rows[0], created: false };
  }

  // PROTECTED FIELDS ARE NOT STORED, not merely not scored. Data never collected
  // cannot be scored by a later version of the grader, subpoenaed, or leaked.
  const { safe, rejected: strippedProtected } = (await import("./grading.mjs")).scoreable(answers);

  const normalisedEmail = String(email).trim().toLowerCase();
  const candidate = (await tx.query(
    `INSERT INTO candidates
       (org_id, full_name, email, phone, source, source_detail, disc_profile, linkedin_urn)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (org_id, email) DO UPDATE
       SET full_name = COALESCE(EXCLUDED.full_name, candidates.full_name),
           phone     = COALESCE(EXCLUDED.phone, candidates.phone),
           -- source is NOT overwritten: first-touch attribution is what the
           -- sourcing order in doc 10 is measured against.
           disc_profile = COALESCE(EXCLUDED.disc_profile, candidates.disc_profile),
           linkedin_urn = COALESCE(EXCLUDED.linkedin_urn, candidates.linkedin_urn),
           updated_at = now()
     RETURNING *`,
    [orgId, String(fullName).trim(), normalisedEmail, phone, source, sourceDetail,
     discProfile, linkedinUrn])).rows[0];

  const appliedStage = await stageIdFor(tx, { orgId, stageKey: "applied" });

  const ins = await tx.query(
    `INSERT INTO candidate_applications
       (org_id, candidate_id, role_id, stage_id, answers, video_url,
        job_posting_id, external_application_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
     ON CONFLICT (candidate_id, role_id) WHERE status = 'open' DO NOTHING
     RETURNING *`,
    [orgId, candidate.id, role.id, appliedStage, JSON.stringify(safe), videoUrl,
     jobPostingId, externalApplicationId]);

  if (!ins.rows[0]) {
    const open = await tx.query(
      `SELECT * FROM candidate_applications
        WHERE candidate_id = $1 AND role_id = $2 AND status = 'open'`,
      [candidate.id, role.id]);
    return { candidate, application: open.rows[0], created: false, strippedProtected };
  }

  const application = ins.rows[0];
  const { assigneeRole, assigneeStaffId } =
    await assigneeFor(tx, { orgId, roleKey: role.key });
  await safeTask(tx, {
    orgId,
    title: `New application: ${String(fullName).trim()} (${role.key})`,
    body: `hiring:applied:${application.id}`,
    sourceWorkflow: "hiring-new-application",
    assigneeRole,
    assigneeStaffId
  });

  return { candidate, application, created: true, strippedProtected };
}

/* scoreApplication(tx, spec) → score row

   Runs the grader and PERSISTS the result, including the rubric version as
   applied. Persisting is the point: an AEDT whose inputs and outputs are not
   retained cannot be bias-audited, and an unauditable one is the legal exposure.

   `scoredByStaffId` null means the deterministic grader ran; a staff id means a
   person scored or overrode it. Both are kept — an override rate is one of the
   more useful signals in a bias review. */
export async function scoreApplication(tx, {
  orgId, applicationId, stageKey = "applied", categoryScores = {},
  scoredByStaffId = null
} = {}) {
  const app = (await tx.query(
    `SELECT a.*, r.id AS role_id FROM candidate_applications a
       JOIN hiring_roles r ON r.id = a.role_id
      WHERE a.id = $1`, [applicationId])).rows[0];
  if (!app) { const e = new Error("application not found"); e.code = "NOT_FOUND"; throw e; }

  // Role-specific rubric wins over the org default; highest active version wins.
  const rubric = (await tx.query(
    `SELECT * FROM hiring_rubrics
      WHERE org_id = $1 AND stage_key = $2 AND active
        AND (role_id = $3 OR role_id IS NULL)
      ORDER BY (role_id IS NOT NULL) DESC, version DESC
      LIMIT 1`,
    [orgId, stageKey, app.role_id])).rows[0];
  if (!rubric) throw new Error(`scoreApplication: no active rubric for stage "${stageKey}"`);

  const result = grade({ rubric, categoryScores, answers: app.answers || {} });

  const { rows } = await tx.query(
    `INSERT INTO application_scores
       (org_id, application_id, stage_key, rubric_id, rubric_version,
        category_scores, average, recommendation, flags, scored_by_staff_id, is_automated)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11)
     RETURNING *`,
    [orgId, applicationId, stageKey, rubric.id, rubric.version,
     JSON.stringify(result.categoryScores), result.average, result.recommendation,
     JSON.stringify(result.flags), scoredByStaffId, scoredByStaffId === null]);

  return { score: rows[0], result };
}

/* advance(tx, spec) → { application, decision }

   Moves an application forward. A human is not strictly required to advance — a
   scheduling job legitimately moves a batch into group_interview — so decidedBy
   is optional here and mandatory in reject(). */
export async function advance(tx, {
  orgId, applicationId, toStageKey, decidedByStaffId = null, reason = null, scoreId = null
} = {}) {
  if (!STAGES.includes(toStageKey)) {
    throw new Error(`advance: "${toStageKey}" is not a forward stage. To reject, call reject().`);
  }

  const app = (await tx.query(
    `SELECT a.*, s.key AS stage_key FROM candidate_applications a
       JOIN pipeline_stages s ON s.id = a.stage_id WHERE a.id = $1
       FOR UPDATE OF a`, [applicationId])).rows[0];
  if (!app) { const e = new Error("application not found"); e.code = "NOT_FOUND"; throw e; }
  if (app.status !== "open") {
    throw new Error(`advance: application is ${app.status}, not open`);
  }

  const toStageId = await stageIdFor(tx, { orgId, stageKey: toStageKey });
  const rec = await latestRecommendation(tx, applicationId);

  const decision = (await tx.query(
    `INSERT INTO hiring_decisions
       (org_id, application_id, decision, from_stage_key, to_stage_key,
        decided_by, reason, score_id, recommendation_at_decision)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [orgId, applicationId, toStageKey === "offer" ? "offer" : "advance",
     app.stage_key, toStageKey, decidedByStaffId, reason, scoreId, rec])).rows[0];

  const updated = (await tx.query(
    `UPDATE candidate_applications
        SET stage_id = $2, entered_stage_at = now(),
            status = CASE WHEN $3 = 'hired' THEN 'hired' ELSE status END
      WHERE id = $1 RETURNING *`,
    [applicationId, toStageId, toStageKey])).rows[0];

  return { application: updated, decision };
}

/* reject(tx, spec) → { application, decision }

   THE GATE. decidedByStaffId and reason are both required, and the database
   requires them again. Doc 11 also requires the reason operationally — "Give
   feedback to candidates via email and let your AM and RAM know who you didn't
   move forward and why" — and a rejection with no reason cannot produce that
   email. */
export async function reject(tx, {
  orgId, applicationId, decidedByStaffId, reason, scoreId = null, notifyCandidate = true
} = {}) {
  if (!decidedByStaffId) {
    throw new Error(
      "reject: decidedByStaffId is required. No candidate may be rejected by software — " +
      "the grader produces recommendations, a person produces decisions (051_hiring.sql)."
    );
  }
  if (!reason || !String(reason).trim()) {
    throw new Error(
      "reject: a reason is required. It is what the candidate feedback email is written from " +
      "and what an adverse-impact review reads."
    );
  }

  const app = (await tx.query(
    `SELECT a.*, s.key AS stage_key FROM candidate_applications a
       JOIN pipeline_stages s ON s.id = a.stage_id WHERE a.id = $1
       FOR UPDATE OF a`, [applicationId])).rows[0];
  if (!app) { const e = new Error("application not found"); e.code = "NOT_FOUND"; throw e; }
  /* THE SAME GUARD advance() HAS AT :179. Without it a stale screen — or a
     second click after a request whose response was lost — rejects somebody who
     was already hired, and writes a second, undeletable adverse decision for one
     candidate into the table an adverse-impact review reads. The row lock above
     makes two simultaneous callers take turns rather than both pass this check. */
  if (app.status !== "open") {
    throw new Error(`reject: application is ${app.status}, not open`);
  }

  const rec = await latestRecommendation(tx, applicationId);
  const rejectedStage = await stageIdFor(tx, { orgId, stageKey: "rejected" });

  // The decision row goes in FIRST: the terminal-status trigger on
  // candidate_applications refuses the status change without it, which is what
  // makes the ordering a database property rather than a habit.
  const decision = (await tx.query(
    `INSERT INTO hiring_decisions
       (org_id, application_id, decision, from_stage_key, to_stage_key,
        decided_by, reason, score_id, recommendation_at_decision)
     VALUES ($1,$2,'reject',$3,'rejected',$4,$5,$6,$7)
     RETURNING *`,
    [orgId, applicationId, app.stage_key, decidedByStaffId, String(reason).trim(),
     scoreId, rec])).rows[0];

  const updated = (await tx.query(
    `UPDATE candidate_applications
        SET status = 'rejected', stage_id = $2, entered_stage_at = now()
      WHERE id = $1 RETURNING *`,
    [applicationId, rejectedStage])).rows[0];

  // Doc 11's feedback obligation, as a task so it reaches a person rather than
  // depending on somebody remembering.
  if (notifyCandidate) {
    await safeTask(tx, {
      orgId,
      title: `Send candidate feedback: application ${applicationId}`,
      sourceWorkflow: "hiring-candidate-feedback",
      assigneeRole: "admin",
      eventId: `hiring:feedback:${applicationId}`
    });
  }

  return { application: updated, decision };
}

/* recordGroupInterview(tx, spec) → results[]

   Doc 11's rule, implemented literally: "We should be moving all candidates that
   are absolute 'yes' and 'maybes' forward to the 1on1 round" and "Move people onto
   next step even if you're 50/50".

   So 'yes' and 'maybe' both advance automatically — advancing is not an adverse
   action and needs no gate. 'no' does NOT auto-reject: it is left in place for a
   human to reject explicitly, because that IS an adverse action. */
export async function recordGroupInterview(tx, {
  orgId, interviewId, outcomes = [], decidedByStaffId = null
} = {}) {
  const results = [];
  for (const { applicationId, outcome, attended = true, notes = null } of outcomes) {
    await tx.query(
      `INSERT INTO hiring_interview_attendees
         (org_id, interview_id, application_id, attended, outcome, notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (interview_id, application_id) DO UPDATE
         SET attended = EXCLUDED.attended, outcome = EXCLUDED.outcome,
             notes = EXCLUDED.notes, updated_at = now()`,
      [orgId, interviewId, applicationId, attended, outcome, notes]);

    if (outcome === "yes" || outcome === "maybe") {
      const moved = await advance(tx, {
        orgId, applicationId, toStageKey: "one_on_one", decidedByStaffId,
        reason: `group interview: ${outcome} — advancing per the group-interview SOP (yes and maybe both move forward)`
      });
      results.push({ applicationId, outcome, advanced: true, decision: moved.decision.id });
    } else {
      // Deliberately NOT a rejection. A 'no' here queues a human to make and
      // record that decision.
      await safeTask(tx, {
        orgId,
        title: `Group interview 'no' — decide and record: application ${applicationId}`,
        sourceWorkflow: "hiring-group-interview-review",
        assigneeRole: "admin",
        eventId: `hiring:gi-no:${interviewId}:${applicationId}`
      });
      results.push({ applicationId, outcome, advanced: false, awaitingHumanDecision: true });
    }
  }

  await tx.query(`UPDATE hiring_interviews SET status = 'held' WHERE id = $1`, [interviewId]);
  return results;
}

/* latestRecommendation — what the grader last said, recorded onto the decision.
   This is the column that answers "how often do humans follow the machine",
   which is the central question in an AEDT review. */
async function latestRecommendation(tx, applicationId) {
  const { rows } = await tx.query(
    `SELECT recommendation FROM application_scores
      WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1`, [applicationId]);
  return rows[0]?.recommendation ?? null;
}

/* safeTask — createTask, but a failure here never blocks the hiring action.

   createTask requires an employee assigneeRole and dedupes on (client_id,
   source_workflow, body). A hiring task has no client, which is supported
   (tasks.client_id is nullable) but means the dedupe key is (NULL, workflow,
   eventId) — fine, and the reason eventId is always supplied. Wrapped because a
   rejection that fails because its follow-up task failed would leave the
   candidate in limbo. */
async function safeTask(tx, spec) {
  try {
    return await createTask(tx, { clientId: null, ...spec });
  } catch (err) {
    return { created: false, reason: `task_failed: ${String(err.message).slice(0, 120)}` };
  }
}

export default { apply, scoreApplication, advance, reject, recordGroupInterview, stageIdFor };

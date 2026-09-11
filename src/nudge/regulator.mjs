// Rounds 4 and 5 — the regulator ping. Owner-set 2026-09-05: "it is a simple
// ping." So this file is small on purpose, and the largest thing in it is a
// refusal.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Credit-repair escalation state.
// NOTHING HERE FILES ANYTHING, transmits anything, or tells a regulator
// anything. It records three states and who said so.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE ONE RULE
//
// We prepare the CFPB and state attorney general complaints. The CLIENT signs
// them under penalty of perjury and files them personally. Nothing in this
// system has ever known whether that happened, and
// src/metro2/letters/catalog.mjs:57-65 says so in as many words:
//
//   "No table, column, endpoint or workflow in this repository ever hears
//    whether that happened... THAT ABSENCE IS A FINDING, NOT A GAP TO FILL."
//
// This is the smallest honest thing that hears it: one question, asked of the
// client, and their answer.
//
//   prepared  we built the form
//   sent      it left us, on this date
//   filed     THE CLIENT SAID THEY FILED IT — and nothing else, ever
//
// `filed` is unreachable from this module except through
// recordClientAnswer({ filed: true }). Staff cannot set it, no workflow sets
// it, and 366's CHECK refuses the state without filed_source='client_reported'
// even if somebody writes raw SQL. A page renders `sent` as sent. It renders
// `filed` as filed only because the client said so, and it should say who said
// so — `filed_source` is there to be printed.
//
// SILENCE IS NOT A YES. If they answer no, or never answer, the state stays
// `sent` and the waypoint stays open. That is the whole reason the ping rides
// the ordinary chase ladder instead of having a loop of its own: the same four
// rungs, the same eight exit conditions, the same one-message-a-day cap. There
// is no second loop in this file and none should be added.

/** The two complaints, in ladder order: round 4 is the CFPB, round 5 the state
    attorney general. */
export const COMPLAINT_KINDS = Object.freeze(["cfpb", "state_ag"]);

/** The only value `filed_source` may ever hold. Exported so a reader can grep
    for it and find exactly one producer. */
export const FILED_SOURCE = "client_reported";

/**
 * prepareComplaint — record that we built the form. Idempotent: a re-run of
 * whatever generates the pack updates the row rather than doubling it, keyed on
 * 366's UNIQUE (client_id, kind).
 *
 * A complaint already `sent` or `filed` is NOT walked back to `prepared` —
 * regenerating the paperwork does not un-send it.
 */
export async function prepareComplaint(db, { orgId, clientId, kind, waypointId = null } = {}) {
  if (!orgId) throw new Error("prepareComplaint: orgId is required");
  if (!clientId) throw new Error("prepareComplaint: clientId is required");
  if (!COMPLAINT_KINDS.includes(kind)) {
    throw new Error(`prepareComplaint: kind must be one of ${COMPLAINT_KINDS.join(", ")}`);
  }
  const { rows } = await db.query(
    `INSERT INTO regulator_complaints (org_id, client_id, kind, waypoint_id, state)
     VALUES ($1,$2,$3,$4,'prepared')
     ON CONFLICT (client_id, kind) DO UPDATE
       SET waypoint_id = COALESCE(EXCLUDED.waypoint_id, regulator_complaints.waypoint_id)
     RETURNING id, state, waypoint_id`,
    [orgId, clientId, kind, waypointId]
  );
  return rows[0];
}

/**
 * markComplaintSent — it left us, on this date. Called by whatever actually
 * puts the pack in the client's hands; this module does not send it.
 *
 * Already-sent and already-filed rows are left alone rather than re-stamped, so
 * the date on the page stays the date it really went.
 */
export async function markComplaintSent(db, { clientId, kind, at = new Date() } = {}) {
  const { rows } = await db.query(
    `UPDATE regulator_complaints
        SET state = 'sent', sent_at = $3::timestamptz
      WHERE client_id = $1 AND kind = $2 AND state = 'prepared'
      RETURNING id, state, sent_at`,
    [clientId, kind, (at instanceof Date ? at : new Date(at)).toISOString()]
  );
  if (rows[0]) return { changed: true, ...rows[0] };
  const current = (await db.query(
    `SELECT id, state, sent_at FROM regulator_complaints WHERE client_id = $1 AND kind = $2 LIMIT 1`,
    [clientId, kind]
  )).rows[0] || null;
  return current ? { changed: false, ...current } : { changed: false, id: null, state: null };
}

/**
 * recordClientAnswer — the client's reply to the ping, and the ONLY door to
 * `filed`.
 *
 * `filed:false` (they said no) and a missing answer are the same thing to the
 * database: nothing moves, the state stays `sent`, the waypoint stays open, and
 * we ask again on the next rung until the ladder terminates.
 *
 * A case number is only stored alongside a yes, because 366 refuses one on any
 * other state — a case number is proof of a filing and cannot exist without
 * one. A blank or whitespace-only number is dropped rather than stored, so a
 * screen can never render whitespace as proof.
 *
 * The client's waypoint is completed in the same call when they say yes,
 * because that is the fact the checklist is tracking. Completing it is also
 * what makes the chase ladder's exit condition 1 true, so the pings stop.
 */
export async function recordClientAnswer(db, { clientId, kind, filed, caseNumber = null, at = new Date() } = {}) {
  const when = (at instanceof Date ? at : new Date(at)).toISOString();
  const current = (await db.query(
    `SELECT id, state, waypoint_id FROM regulator_complaints
      WHERE client_id = $1 AND kind = $2 LIMIT 1`,
    [clientId, kind]
  )).rows[0];
  if (!current) return { changed: false, state: null, reason: "no_complaint" };

  if (filed !== true) {
    /* NOT A NO-OP BY ACCIDENT — a no-op on purpose. See the header: silence and
       "no" are the same answer and neither moves the state. */
    return { changed: false, id: current.id, state: current.state, reason: "not_filed" };
  }
  if (current.state === "filed") {
    return { changed: false, id: current.id, state: "filed", reason: "already_filed" };
  }
  if (current.state !== "sent") {
    /* 366's forward-only trigger would refuse this anyway. Refusing it here as
       well gives the caller a reason instead of an exception: a complaint that
       never left us cannot have been filed, whatever the client believes they
       filed. */
    return { changed: false, id: current.id, state: current.state, reason: "not_sent_yet" };
  }

  const number = typeof caseNumber === "string" && caseNumber.trim() !== ""
    ? caseNumber.trim()
    : null;

  const { rows } = await db.query(
    `UPDATE regulator_complaints
        SET state = 'filed', filed_at = $2::timestamptz,
            filed_source = $3, case_number = $4
      WHERE id = $1
      RETURNING id, state, filed_at, filed_source, case_number, waypoint_id`,
    [current.id, when, FILED_SOURCE, number]
  );
  const row = rows[0];

  if (row?.waypoint_id) {
    /* The checklist row is what the client sees, so it moves with the fact.
       Guarded on state so a waypoint somebody already closed is not restamped
       with a later completion date. */
    await db.query(
      `UPDATE client_waypoints
          SET state = 'done', completed_at = $2::timestamptz
        WHERE id = $1 AND state <> 'done'`,
      [row.waypoint_id, when]
    );
  }
  return { changed: true, ...row };
}

/** complaintsFor — what the page may render. Nothing computed, nothing
    inferred: the stored state and, when it is `filed`, who said so. */
export async function complaintsFor(db, clientId) {
  const { rows } = await db.query(
    `SELECT id, kind, state, prepared_at, sent_at, filed_at, filed_source, case_number, waypoint_id
       FROM regulator_complaints WHERE client_id = $1 ORDER BY kind`,
    [clientId]
  );
  return rows;
}

export default {
  COMPLAINT_KINDS, FILED_SOURCE,
  prepareComplaint, markComplaintSent, recordClientAnswer, complaintsFor
};

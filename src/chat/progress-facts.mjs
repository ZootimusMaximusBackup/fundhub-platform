// What the portal assistant is allowed to know about where a client's file is.
//
// PLAN STEP 7: "api/chat/* already reaches a client principal. Give it the
// progress facts as context, then the nudge on a stalled waypoint, reusing the
// existing agent runtime rather than a new one."
//
// Today the assistant knows four things (src/chat/portal-assistant.mjs:16-25):
// a first name, whether a soft pull is done, a pre-qual figure and whether a
// call is booked. So "where is my file" was answered out of thin air, or not at
// all. These are the facts that answer it.
//
//
// *** WHY THIS READS THE DATABASE AND NOT /api/read/client-progress. ***
//
// The obvious move is to call the endpoint the progress page calls. It is the
// wrong one twice over: a server calling its own HTTP route needs a credential
// it does not have and adds a network hop inside a request that is already
// waiting on a model, and that endpoint is being built by a different lane in
// parallel with this one.
//
// So this reads the same tables the endpoint reads, and it reads FEWER of them
// on purpose. It is deliberately not a second implementation of the contract:
//   - no scores, no score series, no movement
//   - no timeline
//   - no deliverables, no documents
//   - no money, no prices, no paid services
// Just enough to answer "where am I, what is next, and whose job is it".
// If those two reads ever disagree the screen is right and this is stale, which
// is why nothing here is quoted back as a number the client could act on.
//
//
// *** WHAT IT REFUSES TO SAY, AND WHY EACH ONE. ***
//
// ROUNDS 4 AND 5 ARE NEVER DESCRIBED AS LODGED WITH ANYONE. R4 is a complaint to
// a federal regulator and R5 to a state attorney general, and
// src/metro2/letters/catalog.mjs:57-65 records that NOTHING in this system knows
// whether either was actually submitted — only that a letter was produced. The
// round number is reported; a claim about what a regulator has received is not,
// and roundIsEscalation() is what the prompt uses to say so out loud.
//
// A PAID ROUND IS NEVER OFFERED HERE. Prices, checkout links and the round
// button live on the progress page behind a double confirmation, and
// src/subscriptions/charger.mjs:25 records that nothing in this repo can charge
// a stored card. An assistant that talked about buying a round would be the one
// surface in this product where money is discussed without a price breakdown in
// front of the person. The stalled-waypoint nudge names the STEP, never a price.
//
// NULL SURVIVES. Every field below is null when it is not known, and the prompt
// builder says "we do not know" rather than filling a gap with a plausible date.

/* The current round and the cap. dispute_cases.round is 'R1'..'R6' or
   'FURNISHER'; the numeric part is what a client understands. FURNISHER has no
   number and is reported as null rather than being squeezed into the ladder. */
export function roundNumber(roundKey) {
  const m = /^R([1-6])$/.exec(String(roundKey || "").trim().toUpperCase());
  return m ? Number(m[1]) : null;
}

/** Round 4 and above are the escalation letters. See the header. */
export function roundIsEscalation(round) {
  return Number(round) >= 4;
}

const STAGE_WORDS = {
  open: "being prepared",
  awaiting_response: "with the bureaus, waiting on their reply",
  round_complete: "finished for this round",
  stalled: "delayed, and we are looking into it",
  closed: "closed",
  cancelled: "cancelled"
};

/* readProgressFacts — one client, one small answer.
 *
 * Never throws. The assistant is best-effort by design (see replyFor() in
 * api/chat/portal-message.mjs: the client's message is already committed before
 * the model is asked), so a database hiccup here must degrade to "we do not
 * know" and not turn a saved message into a 500. */
export async function readProgressFacts(db, { orgId, clientId } = {}) {
  const empty = {
    known: false,
    roundCurrent: null,
    roundCap: null,
    stageWords: null,
    expectedResponseBy: null,
    nextStep: null
  };
  if (!db || !orgId || !clientId) return empty;

  try {
    /* THE ROUND. One row per bureau per round, so the newest case is the one
       that says where the file is. Ordered by round then recency, because a
       client on R3 with an old R1 row open must not be reported as being on R1. */
    const caseRow = (await db.query(
      `SELECT round, status, response_due_at
         FROM dispute_cases
        WHERE org_id = $1 AND client_id = $2
          AND status NOT IN ('closed', 'cancelled')
        ORDER BY round DESC, updated_at DESC
        LIMIT 1`,
      [orgId, clientId]
    )).rows[0] || null;

    /* THE CAP. repair_programs.rounds_cap — 2 for the trial, 6 for a full
       programme. Owner-set and not to be recomputed
       (docs/DELIVERABLES-AND-REPAIR-TRUTH.md §6). Absent for a client with no
       programme, which stays null rather than defaulting to 6. */
    const program = (await db.query(
      `SELECT rounds_cap FROM repair_programs
        WHERE org_id = $1 AND client_id = $2 AND status = 'active'
        LIMIT 1`,
      [orgId, clientId]
    )).rows[0] || null;

    /* THE ONE NEXT STEP. The lowest open waypoint the CLIENT owns, because that
       is the only kind the assistant can usefully nudge — telling somebody that
       Fundhub owes them something is not a nudge, it is an apology, and it is
       the status line's job. overdue is computed from due_at and never stored,
       so it cannot go stale. */
    const waypoint = (await db.query(
      `SELECT title, due_at,
              (due_at IS NOT NULL AND due_at < now()) AS overdue
         FROM client_waypoints
        WHERE org_id = $1 AND client_id = $2
          AND owner_kind = 'client'
          AND state IN ('not_started', 'in_progress')
        ORDER BY position ASC, key ASC
        LIMIT 1`,
      [orgId, clientId]
    )).rows[0] || null;

    const round = caseRow ? roundNumber(caseRow.round) : null;

    return {
      known: !!(caseRow || program || waypoint),
      roundCurrent: round,
      roundCap: program && program.rounds_cap != null ? Number(program.rounds_cap) : null,
      stageWords: caseRow ? (STAGE_WORDS[caseRow.status] || null) : null,
      expectedResponseBy: caseRow && caseRow.response_due_at
        ? new Date(caseRow.response_due_at).toISOString().slice(0, 10)
        : null,
      nextStep: waypoint
        ? { title: String(waypoint.title), overdue: !!waypoint.overdue }
        : null
    };
  } catch {
    // Unknown, not zero. The prompt builder says so in words.
    return empty;
  }
}

/* progressFactLines — the facts as sentences for the system prompt.
 *
 * Returns [] when nothing is known, so the prompt keeps its existing shape
 * rather than gaining a block of "we do not know" lines that would teach the
 * model to talk about a file it has no facts on. */
export function progressFactLines(facts) {
  if (!facts || !facts.known) return [];
  const lines = [];

  if (facts.roundCurrent != null && facts.roundCap != null) {
    lines.push(`Their file is on round ${facts.roundCurrent} of ${facts.roundCap}.`);
  } else if (facts.roundCurrent != null) {
    lines.push(`Their file is on round ${facts.roundCurrent}. You do not know how many rounds their programme includes, so do not say.`);
  }

  if (facts.stageWords) {
    lines.push(`That round is ${facts.stageWords}.`);
  }

  if (facts.expectedResponseBy) {
    lines.push(`The bureaus have until ${facts.expectedResponseBy} to reply. That is a deadline for THEM, not a promise about the outcome.`);
  } else if (facts.roundCurrent != null) {
    lines.push("There is no reply date on their file. If they ask when they will hear back, say you do not have a date and their advisor will confirm it.");
  }

  /* THE ONE THING THAT MUST NOT BE SAID. See the header. */
  if (roundIsEscalation(facts.roundCurrent)) {
    lines.push(
      "Rounds 4 and above are escalation letters to a regulator or a state attorney general. "
      + "You know ONLY that this round is in progress. You do NOT know whether any complaint "
      + "has been received, accepted, opened or acted on by anybody, and this system does not "
      + "record that. Never say or imply that one has been."
    );
  }

  if (facts.nextStep) {
    lines.push(facts.nextStep.overdue
      ? `The one thing waiting on THEM is: ${facts.nextStep.title}. It is past its date. If it fits the conversation, remind them once, kindly, and move on. Do not nag and do not repeat it.`
      : `The one thing waiting on THEM is: ${facts.nextStep.title}.`);
  } else {
    lines.push("There is nothing waiting on them right now. If they ask what they should do, tell them nothing is needed from them at the moment.");
  }

  return lines;
}

export default readProgressFacts;

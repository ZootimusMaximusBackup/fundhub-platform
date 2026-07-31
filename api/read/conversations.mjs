// GET /api/read/conversations?client_id=<uuid> — the Closer Dashboard pre-call panel.
//
// One row per thread the client has with us, newest activity first, so the
// closer opens the call already knowing what channel the last contact came
// through and what it was about.
//
// client_id IS REQUIRED, exactly as in api/read/tradelines.mjs. A conversation
// summary is a paraphrase of what a person told us; a paginated firehose of
// everybody's threads is not a screen anyone asked for, and "forgot the
// parameter" must never degrade into "return the whole table". The check lives
// inside fetch() so it runs AFTER auth and the role gate: an anonymous caller
// gets 401, not a 400 that confirms the endpoint exists.
//
// WHY THE GUARD THROWS A SQLSTATE. readHandler's only 400 path is
// CLIENT_DATA_ERRORS, keyed on err.code. 22P02 (invalid_text_representation) is
// precisely the code Postgres itself raises when a non-uuid string is compared
// to a uuid column — this raises it a round-trip early, which is the stated
// purpose of isUuid() in read-api.mjs. Nothing is being faked: the same request
// reaches the same 400 either way, just without waking the database.
//
// SENTIMENT IS NULL FOR EVERY ROW TODAY. conversations.sentiment exists in
// db/schema/001_init.sql (commented "Hot | Warm | Cold") and nothing in this
// repo ever writes it. It is passed through as null. It is NOT defaulted to
// "Cold", not inferred from last_pulse_at, and not computed from the message
// history — an invented sentiment on a pre-call panel is a closer being told
// something about a person that no one observed.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS, isUuid } from "../../src/http/read-api.mjs";

export const run = readHandler({
  roles: ROLE_SETS.STAFF,
  fetch: (db, { limit, offset, query }) => {
    const raw = query.client_id;
    if (!isUuid(raw)) {
      throw Object.assign(
        new Error("client_id is required and must be a uuid"),
        { code: "22P02" }
      );
    }

    // No org filter, matching read/documents and read/funding-rounds: the
    // client_id is already the narrowest possible scope, and conversations.org_id
    // is derived from the client's own org on insert. Add one here only when
    // there is a second org to separate, not on speculation.
    //
    // NULLS LAST is load-bearing. last_pulse_at is nullable and a thread that
    // has never pulsed is the LEAST recent thing, not the most; Postgres sorts
    // NULLs first under DESC by default, which would have floated every silent
    // thread to the top of the panel.
    return db.query(
      `SELECT id, channel, summary, sentiment, last_pulse_at, created_at
         FROM conversations
        WHERE client_id = $3
        ORDER BY last_pulse_at DESC NULLS LAST, created_at DESC
        LIMIT $1 OFFSET $2`,
      [limit + 1, offset, raw.trim()]
    ).then((r) => r.rows);
  }
});

// An unknown client_id is a well-formed question with an empty answer: 200 with
// items: []. NOT a 404 — the endpoint exists, and probing it for whether a given
// uuid is a real client is not a service we owe an unauthenticated guesser.
export default (req, res) => run(req, res, { db, requireAuth });

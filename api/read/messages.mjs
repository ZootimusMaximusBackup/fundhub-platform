// GET /api/read/messages?conversation_id=<uuid> — one thread, both directions.
//
// The other half of the staff reply inbox: api/read/inbox.mjs lists the threads,
// this reads inside one. Every row `messages` holds for that conversation —
// what the client sent us and what we sent them, in one list, because a thread
// that shows only one side is not a conversation.
//
// conversation_id IS REQUIRED, for the same reason client_id is required on
// api/read/conversations.mjs: "forgot the parameter" must never degrade into
// "return every message in the company". The guard throws SQLSTATE 22P02 so
// readHandler's CLIENT_DATA_ERRORS branch turns it into a 400 — the same 400
// Postgres itself would raise for a non-uuid against a uuid column, a
// round-trip early. It runs inside fetch(), which is AFTER auth and the role
// gate, so an anonymous caller gets 401 and learns nothing about which
// endpoints exist.
//
// ORG COMES FROM THE SESSION. conversation_id arrives in the query string, so
// it is a value the caller chooses, and a filter on a value the caller chooses
// is not a scope (audit C1). A session with no org binds NULL and matches no
// row — it fails CLOSED. Note the filter is on messages.org_id, the column on
// the rows actually being returned, rather than only on the conversation's:
// a message and its thread carry the same org, and filtering the thing you are
// returning is the check that cannot be defeated by a bad join.
//
// NEWEST FIRST, and the screen reverses it. A thread read wants the END of the
// history, not the beginning — that is what somebody replying is looking at —
// and offset paging from the oldest message would put the useful page last and
// move it every time a message arrives. So `?limit=` returns the most recent N,
// and public/app/messaging.html reverses them for display.
//
// WHAT IS NOT SELECTED, AND WHY:
//   to_address        the destination is on the row, but a thread view is what
//                     was said, not where it was posted. It is a phone number or
//                     an email address on every line of a screen that is often
//                     open on a shared monitor.
//   provider_ref      ours, internal, an idempotency key. Nothing on screen.
//   attempts, provider_message_id
//                     dispatcher bookkeeping. `status`, `blocked_reason` and
//                     `last_error` are the operator-facing parts and those ARE
//                     returned — a staff member whose reply was held must be
//                     able to see that it was held and why.
//
// sender_name is joined from `staff` so the thread can say who replied. It is
// LEFT JOINed: sender_staff_id is NULL on every inbound message and on every
// message a workflow queued, and that NULL means "no person sent this", not
// "unknown person" — see 120_messages_sender.sql.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS, isUuid } from "../../src/http/read-api.mjs";

export const run = readHandler({
  roles: ROLE_SETS.STAFF,
  fetch: (db, { limit, offset, query, staff }) => {
    const raw = query.conversation_id;
    if (!isUuid(raw)) {
      throw Object.assign(
        new Error("conversation_id is required and must be a uuid"),
        { code: "22P02" }
      );
    }

    return db.query(
      `SELECT m.id,
              m.conversation_id,
              m.client_id,
              m.direction,
              m.channel,
              m.rendered_body,
              m.subject,
              m.status,
              m.provider,
              m.blocked_reason,
              m.last_error,
              m.scheduled_at,
              m.sender_staff_id,
              s.name AS sender_name,
              m.created_at
         FROM messages m
         LEFT JOIN staff s ON s.id = m.sender_staff_id
        WHERE m.org_id = $4::uuid
          AND m.conversation_id = $3
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $1 OFFSET $2`,
      [limit + 1, offset, raw.trim(), (staff && staff.org_id) || null]
    ).then((r) => r.rows);
  }
});

// An unknown conversation_id is a well-formed question with an empty answer:
// 200 with items: []. NOT a 404 — the endpoint exists, and confirming whether a
// given uuid is a real thread is not a service owed to somebody guessing.
export default (req, res) => run(req, res, { db, requireAuth });

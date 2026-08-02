// GET /api/read/inbox — every conversation in the company, newest activity first.
//
// The staff reply inbox's list pane. One row per thread, carrying enough to
// render a list item without a second request per row: who it is with, which
// channel, when it last moved, the last thing said, and whether anybody has
// answered it.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS IS NOT api/read/conversations.mjs WITH THE client_id MADE OPTIONAL.
//
// That endpoint requires client_id and its header explains at length why:
// "'forgot the parameter' must never degrade into 'return the whole table'".
// That reasoning is correct for what it is — the Closer Dashboard's pre-call
// panel, which is always about one person — and relaxing it would mean a
// missing parameter silently changed what the endpoint is for.
//
// An inbox is a different question with a different answer. It is cross-client
// BY DEFINITION; there is no id to pass, because the whole point is to see the
// threads you do not already know about. So it is a second endpoint with its
// own name, and the "no client id" case is its normal case rather than a
// degraded one. api/read/conversations.mjs is untouched and is still what the
// client context panel uses to show one person's other threads.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT "UNREAD" MEANS HERE, EXACTLY.
//
//   unread = the most recent message on the thread came from the client.
//
// It is DERIVED, not stored. There is no read receipt in this schema, no
// last_read_at on conversations, and no per-staff read state anywhere — so
// there is no way to know whether a particular employee has looked at a
// particular thread, and this does not pretend otherwise. What it can say from
// the rows that exist is "they spoke last and nobody has replied", which is the
// thing an inbox is actually for: work that is owed.
//
// The consequence, stated plainly so the screen does not overclaim: reading a
// thread does not clear its flag, and replying does. It is a needs-a-reply
// marker, and public/app/messaging.html labels it "needs reply" rather than
// "unread" for that reason. Adding real per-staff read state means a table, a
// write endpoint and a decision about whether read is per-person or per-company
// — none of which is invented here.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE LATERAL, AND WHY IT IS NOT A GROUP BY.
//
// Each thread needs its LAST message — body, direction, time. A GROUP BY gives
// max(created_at) and then needs a self-join to recover the rest of that row.
// LATERAL ... ORDER BY created_at DESC LIMIT 1 asks for the row directly and
// rides idx_messages_thread (117), which is ordered for exactly this.
//
// LEFT JOIN LATERAL, not an inner one. A conversation with no messages is a
// real state — upsertConversation can create the thread before a message row
// lands — and an inbox that hides threads with nothing in them would be hiding
// exactly the ones somebody should look at. Those rows come back with a null
// preview and the screen says so rather than rendering a blank line.
//
// ORDER BY takes the pulse OR the message time, whichever is later. Both
// exist: last_pulse_at is maintained by src/conversations/store.mjs, but it is
// GREATEST-ed and can be NULL on a thread nothing has pulsed. Sorting on the
// pulse alone would strand a thread whose message landed but whose pulse write
// failed (threadMessage swallows that failure by design), which would hide a
// client's message from the inbox. COALESCE of the two cannot.
//
// ORG COMES FROM THE SESSION and nowhere else. This is the endpoint audit C1
// was about — a cross-client list with no id in the request — so the filter is
// on the session's org, a session with none binds NULL, and it fails CLOSED.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

export const run = readHandler({
  roles: ROLE_SETS.STAFF,
  fetch: (db, { limit, offset, staff }) => db.query(
    `SELECT c.id,
            c.client_id,
            c.channel,
            c.summary,
            c.sentiment,
            c.last_pulse_at,
            c.created_at,
            cl.first_name,
            cl.last_name,
            last.id            AS last_message_id,
            last.direction     AS last_direction,
            last.rendered_body AS last_body,
            last.status        AS last_status,
            last.created_at    AS last_at,
            -- See the header: this is "they spoke last", not "nobody has read it".
            (last.direction = 'inbound')            AS needs_reply,
            COALESCE(last.created_at, c.last_pulse_at, c.created_at) AS activity_at
       FROM conversations c
       JOIN clients cl
         ON cl.id = c.client_id
        AND cl.org_id = c.org_id
       LEFT JOIN LATERAL (
         SELECT m.id, m.direction, m.rendered_body, m.status, m.created_at
           FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT 1
       ) last ON true
      WHERE c.org_id = $3::uuid
      ORDER BY COALESCE(last.created_at, c.last_pulse_at, c.created_at) DESC, c.id DESC
      LIMIT $1 OFFSET $2`,
    [limit + 1, offset, (staff && staff.org_id) || null]
  ).then((r) => r.rows)
});

/* sentiment IS PASSED THROUGH AS NULL, exactly as api/read/conversations.mjs
   does, and for the reason written at length in src/conversations/store.mjs:
   nothing in this repository computes Hot/Warm/Cold. It is selected rather than
   dropped so the shape matches the sibling endpoint; the screen does not render
   it, because a guessed sentiment on an inbox row is a claim about a person
   nobody observed. */
export default (req, res) => run(req, res, { db, requireAuth });

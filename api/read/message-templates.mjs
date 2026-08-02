// GET /api/read/message-templates — the message copy library the template
// editor (public/app/template-editor.html) reads.
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; the SQL and the usage annotation are this file's. See
// that module for why the role default is deny and what redact() strips.
//
// THE BODY IS RETURNED NOW, AND IT WAS NOT BEFORE. This endpoint used to send
// `length(body) AS body_length` — enough to render a library listing, not enough
// to edit anything. Returning the copy is the whole point of the editor, and it
// widens nothing: the row is already gated to ROLE_SETS.STAFF, and message copy
// is what staff say to clients all day. A template carries no client data of any
// kind — it is the sentence before anybody's name is put into it.
//
// EACH ROW CARRIES ITS OWN "WHO USES THIS". Computed here rather than in a
// second endpoint, because the screen needs it on the first paint of every row
// and because that answer is what decides whether the key may change at all. See
// src/messaging/template-usage.mjs for what counts as a reference.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";
import { annotateTemplates } from "../../src/messaging/template-usage.mjs";

/* THE ORG COMES FROM THE SESSION AND IS REQUIRED (audit C1).
   A session with no org binds NULL, and `org_id = NULL::uuid` matches no row —
   it fails CLOSED. That is deliberate: the alternative, omitting the clause when
   the org is unknown, turns a broken session into a firehose over every
   company's rows. See src/http/read-api.mjs:150-153, which records the decision
   to leave scoping to each endpoint's own SQL — a decision that then went
   unimplemented in ten endpoints while the comment stayed. */
const orgOf = (staff) => (staff && staff.org_id) || null;

/* The saved journeys, read so each template can report which of them point at
   it. READ-ONLY — this endpoint never writes to `journeys`.

   A failure to read them must not take the template list down with it. The list
   is still useful with workflow usage alone, and an empty result degrades to
   "no journey uses this", which the screen presents as an unknown rather than as
   a fact — see the caveat it renders when this comes back empty. */
async function loadJourneys(db, orgId) {
  try {
    const { rows } = await db.query(
      `SELECT key, name, nodes FROM journeys WHERE org_id = $1`, [orgId]);
    return rows;
  } catch {
    return [];
  }
}

const run = readHandler({
  roles: ROLE_SETS.STAFF,
  fetch: async (db, { limit, offset, query, staff }) => {
    const orgId = orgOf(staff);
    const [tpl, journeyRows] = await Promise.all([
      db.query(`SELECT t.id, t.template_key, t.channel, t.subject, t.body,
                       t.compliance_passed, t.source_doc,
                       t.approved_at, t.approved_by, t.approved_body_sha,
                       s.name AS approved_by_name,
                       t.created_at, t.updated_at
                  FROM message_templates t
             LEFT JOIN staff s ON s.id = t.approved_by
                 WHERE t.org_id = $5::uuid
                   AND ($3::text IS NULL OR t.channel = $3)
                   AND ($4::text IS NULL OR t.template_key ILIKE '%' || $4 || '%')
                 ORDER BY t.channel, t.template_key
                 LIMIT $1 OFFSET $2`,
        [limit + 1, offset, query.channel || null, query.q || null, orgId]),
      loadJourneys(db, orgId)
    ]);
    return annotateTemplates(tpl.rows, { journeyRows });
  }
});

export default (req, res) => run(req, res, { db, requireAuth });

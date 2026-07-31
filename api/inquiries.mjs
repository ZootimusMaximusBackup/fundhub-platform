// /api/inquiries — the Inquiry Remover dashboard's write path.
//
//   GET   ?inquiry_id=<uuid>            → { ok, attempts: [...] }   (expand row history)
//   POST  { inquiry_id, action: "attempt",  kind?, outcome?, note? }
//   POST  { inquiry_id, action: "confirm",  status? }
//   POST  { inquiry_id, action: "status",   status }
//         → { ok, inquiry }
//
// Auth: any staff session. The reads stay where they were — /api/read/inquiries
// still serves the queue; this endpoint only changes things.
//
// NOT NAMED /api/inquiry. That path already exists and proxies the external
// Airtable runtime; this one writes the local inquiry_log table. Two different
// systems, two different paths, no ambiguity about which one a call hit.
//
// *** THE POST BRANCH REQUIRES AN OPEN SHIFT. THE GET BRANCH DOES NOT. ***
//
// The rule this implements, verbatim from the owner: "Gate writes that affect
// attribution or pay: claiming a lead, logging a call outcome, moving a pipeline
// stage, sending client messages. Do not gate read-only screens."
//
// All three POST actions land on inquiry_log.worked_by / worked_at — the columns
// that say WHO did this piece of work — via src/inquiries/work.mjs. `attempt`
// with the default kind:"call" is literally "logging a call outcome"; `confirm`
// and `status` ride the same branch and write the same attribution columns, so
// they are gated too rather than being split off into a second, weaker rule.
// A row that records work against a staff member with no shift to bill it to is
// exactly the hole the gate closes.
//
// GET is untouched on purpose. It expands one row's attempt history and changes
// nothing. Gating it would 403 the screen that renders the clock-in button.
import { db } from "../src/db.mjs";
import { requirePrincipal } from "../src/http/middleware/requirePrincipal.mjs";
import { requireActiveShift } from "../src/http/middleware/requireActiveShift.mjs";
import { isUuid, CLIENT_DATA_ERRORS } from "../src/http/read-api.mjs";
import { logAttempt, confirmRemoval, setStatus, listAttempts, InquiryWriteError } from "../src/inquiries/work.mjs";

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff"], { db });
  if (!principal) return;
  const staffId = principal.staffId;

  try {
    if (req.method === "GET") {
      const inquiryId = (req.query || {}).inquiry_id;
      if (!isUuid(inquiryId)) return res.status(400).json({ ok: false, error: "inquiry_id must be a uuid" });
      return res.status(200).json({ ok: true, attempts: await listAttempts(db, { inquiryId }) });
    }

    if (req.method === "POST") {
      /* The shift gate composes AFTER requirePrincipal above, never instead of
         it: requirePrincipal decides WHO this is, this decides whether they are
         on the clock. The principal is passed explicitly because requirePrincipal
         attaches nothing to `req` — it calls authenticate() directly, so there is
         no req.staff here for the gate to read.

         It is first in the branch, before the body is even looked at: whether you
         may write at all is not a question about the payload. It writes its own
         refusal and returns null, so `if (!shift) return;` is the whole contract —
         including the 503 it answers when the shift CHECK itself failed, which
         must never collapse into "you are not clocked in" and must never fall
         through to the write. */
      const shift = await requireActiveShift(req, res, { db, principal });
      if (!shift) return;

      const body = req.body || {};
      const inquiryId = body.inquiry_id;
      if (!isUuid(inquiryId)) return res.status(400).json({ ok: false, error: "inquiry_id must be a uuid" });

      let inquiry;
      switch (body.action) {
        case "attempt":
          inquiry = await logAttempt(db, {
            inquiryId, staffId,
            kind: body.kind || "call",
            outcome: body.outcome ?? null,
            note: body.note ?? null
          });
          break;
        case "confirm":
          inquiry = await confirmRemoval(db, { inquiryId, staffId, ...(body.status ? { status: body.status } : {}) });
          break;
        case "status":
          inquiry = await setStatus(db, { inquiryId, staffId, status: body.status });
          break;
        default:
          return res.status(400).json({ ok: false, error: "action must be one of: attempt, confirm, status" });
      }
      return res.status(200).json({ ok: true, inquiry });
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    if (e instanceof InquiryWriteError) return res.status(e.status).json({ ok: false, error: e.message });
    if (CLIENT_DATA_ERRORS.has(e.code)) return res.status(400).json({ ok: false, error: "bad request parameter" });
    throw e;
  }
}

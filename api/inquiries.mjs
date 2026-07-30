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
import { db } from "../src/db.mjs";
import { requirePrincipal } from "../src/http/middleware/requirePrincipal.mjs";
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

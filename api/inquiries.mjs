// /api/inquiries — the Inquiry Remover dashboard's write path.
//
//   GET   ?inquiry_id=<uuid>            → { ok, attempts: [...] }   (expand row history)
//   GET   ?recent=letters&limit=n       → { ok, letters: [...] }    (SPECIALIST DESK ONLY)
//   POST  { inquiry_id, action: "attempt",  kind?, outcome?, note? }
//   POST  { inquiry_id, action: "confirm",  status? }
//   POST  { inquiry_id, action: "status",   status }
//         → { ok, inquiry }
//
// Auth: any staff session, EXCEPT ?recent=letters — see the role note below.
// The queue read stays where it was: /api/read/inquiries still serves it.
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
//
// *** ?recent=letters IS ROLE-GATED. THE REST OF THIS FILE IS NOT. ***
//
// requirePrincipal above names KINDS — staff / client / affiliate / partner —
// and never looks at staff.role, so every employee passes it: setter, closer and
// sales manager included. That is right for the two branches it was written for.
// It is wrong for ?recent=letters, which returns named clients beside the bureau
// their dispute letter went to, across the whole company. That is the same
// material /api/read/inquiry-cases and /api/read/repair-cases refuse a setter, so
// it answers to the same four roles they do — ROLE_SETS.SPECIALIST_DESK.
//
// The gate lives INSIDE that branch, not at the top of the handler, because
// widening it to the whole file would 403 a closer expanding one row's call
// history on a screen they are allowed to be on.
import { db as sharedDb } from "../src/db.mjs";
import { requirePrincipal } from "../src/http/middleware/requirePrincipal.mjs";
import { requireActiveShift } from "../src/http/middleware/requireActiveShift.mjs";
import { SUPER_ROLES } from "../src/http/middleware/requireRole.mjs";
import { isUuid, CLIENT_DATA_ERRORS, ROLE_SETS, requireRole as requireRoleSet } from "../src/http/read-api.mjs";
import { logAttempt, confirmRemoval, setStatus, setExpectedName, listAttempts, listRecentLetters, InquiryWriteError } from "../src/inquiries/work.mjs";
import { emit } from "../src/events/bus.mjs";

/* `deps.db` exists so a test can DRIVE the role gate below instead of asserting
   on the shape of this source — the sibling read endpoints already take the same
   third argument (api/read/inquiry-cases.mjs:10-11). Production passes nothing
   and gets the shared handle, so `db === sharedDb` on every real request and
   every call site below reads exactly as it did before.

   The import is renamed rather than the local: `db` is the name the rest of this
   file and its guard tests already use, and shadowing it here keeps the diff to
   two lines. */
export default async function handler(req, res, deps = {}) {
  const db = deps.db ?? sharedDb;
  const principal = await requirePrincipal(req, res, ["staff"], { db });
  if (!principal) return;
  const staffId = principal.staffId;
  const orgId = principal.orgId;
  if (!orgId || !isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "no_org_on_session" });
  }

  try {
    if (req.method === "GET") {
      /* ?recent=letters — the Specialist desk's "Recent Letters Issued" block.
         Same org binding as the per-row history below; it reads the letter and
         portal rows of the same table across the whole queue instead of down one
         inquiry. Read-only, so it sits with the GET branch and outside the shift
         gate, for the reason written above.

         ROLE-GATED, unlike the rest of this handler. It names clients and says
         which bureau each one's dispute letter went to, so it is limited to the
         four roles that work this desk. `principal` carries `.role` off the staff
         row (src/http/middleware/requirePrincipal.mjs:40), which is the shape
         requireRoleSet reads. The refusal is written before the query runs, so a
         refused caller costs no read. */
      if (String((req.query || {}).recent || "") === "letters") {
        if (!requireRoleSet(res, principal, ROLE_SETS.SPECIALIST_DESK)) return;
        const letters = await listRecentLetters(db, {
          orgId,
          limit: Number((req.query || {}).limit) || 8
        });
        return res.status(200).json({ ok: true, letters });
      }
      const inquiryId = (req.query || {}).inquiry_id;
      if (!isUuid(inquiryId)) return res.status(400).json({ ok: false, error: "inquiry_id must be a uuid" });
      return res.status(200).json({ ok: true, attempts: await listAttempts(db, { inquiryId, orgId }) });
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
      /* Owners are exempt — owner decision, 2026-08-02: "Owners definitely
         don't clock in." Granted here as well as on api/messages.mjs because
         the decision is about owners, not about messaging: leaving it off this
         endpoint would lock the owner out of the dispute write path with a
         403 telling him to do something he has said he does not do. */
      const shift = await requireActiveShift(req, res, { db, principal, exempt: SUPER_ROLES });
      if (!shift) return;

      const body = req.body || {};
      const inquiryId = body.inquiry_id;
      if (!isUuid(inquiryId)) return res.status(400).json({ ok: false, error: "inquiry_id must be a uuid" });

      let inquiry;
      switch (body.action) {
        case "attempt":
          inquiry = await logAttempt(db, {
            inquiryId, staffId, orgId,
            kind: body.kind || "call",
            outcome: body.outcome ?? null,
            note: body.note ?? null,
            /* The shift the gate above already resolved, threaded down so the
               `staff_events` row this attempt writes says which clock the work
               was on. It is free here — requireActiveShift returned the row —
               and passing it means logAttempt does not repeat the SELECT.
               `shift.id` is never null on this branch: the gate refuses the
               request when there is no open shift. */
            shiftId: shift.id
          });
          break;
        case "confirm":
          inquiry = await confirmRemoval(db, {
            inquiryId, staffId, orgId,
            ...(body.status ? { status: body.status } : {})
          });
          break;
        case "status":
          inquiry = await setStatus(db, { inquiryId, staffId, orgId, status: body.status });
          break;
        case "expected":
          inquiry = await setExpectedName(db, {
            inquiryId, staffId, orgId,
            expectedName: body.expected_name || body.expectedName
          });
          break;
        default:
          return res.status(400).json({ ok: false, error: "action must be one of: attempt, confirm, status, expected" });
      }

      /* Emit inquiry.removed when a row is confirmed/cleared so C-03 can run.
         Business status only — never driven by call_state phone-work. */
      let event = null;
      const st = String(inquiry?.status || "");
      if (/removed|confirmed|cleared|deleted/i.test(st)) {
        try {
          event = await emit(
            db,
            "inquiry.removed",
            {
              inquiryId: inquiry.id,
              bureau: inquiry.bureau,
              inquiry: inquiry.inquiry,
              status: inquiry.status,
              source: "inquiry_log"
            },
            {
              orgId: inquiry.org_id,
              clientId: inquiry.client_id,
              idempotencyKey: `inquiry.removed:log:${inquiry.id}:${st.toLowerCase()}`
            }
          );
        } catch (_) {
          /* Bus failure must not undo the confirm write. */
          event = { ok: false, error: "emit_failed" };
        }
      }

      return res.status(200).json({ ok: true, inquiry, event });
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    if (e instanceof InquiryWriteError) return res.status(e.status).json({ ok: false, error: e.message });
    if (CLIENT_DATA_ERRORS.has(e.code)) return res.status(400).json({ ok: false, error: "bad request parameter" });
    throw e;
  }
}

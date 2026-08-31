// GET /api/read/partner-training — where a partner is in the $10,000 curriculum.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): this endpoint reports whether a
// partner holds the two compliance certifications that stand between them and
// selling under FundHub's brand. The label is a marker, not a request to revisit
// an owner decision.
//
//   (no parameters for a partner — they are pinned to their own record)
//   ?partner_id=<uuid>   REQUIRED for a staff caller
//
// WHY IT IS NOT partnerReadHandler, WHICH EVERY OTHER PARTNER READ USES. That
// helper turns every refusal into a 400, a 404 or a 500, and this endpoint has to
// be able to say 403 with a REASON. The training is a paid deliverable
// (docs/specs/W0-decisions.md: the $10,000 buys "the white-label program plus real
// education and training"), so "you may not open this, and here is why" is a real
// answer a screen has to print — not an error. Everything else is the same three
// locks that helper applies, composed out of its own exported parts rather than
// re-implemented:
//
//   1. requirePrincipal(["partner","staff"]) — a client or affiliate session is
//      refused outright.
//   2. resolvePartnerId — imported from src/http/partner-read-api.mjs, so the
//      tenancy decision is made in ONE place for every partner read. A partner is
//      pinned to their own id and a partner_id in their query string is ignored
//      rather than honoured or rejected; a staff caller must name one.
//   3. withPartnerScope — every query runs inside the scoped transaction, so
//      284's RLS policies filter the rows even if a query forgets its WHERE.
//
// THE ORG COMES FROM THE SESSION AND IS BOUND ON THE PARTNER LOOKUP. RLS filters
// on partner_id alone, so the org comparison below is what stops a partner id
// belonging to another company from resolving at all. A session with no org
// matches no row and the endpoint fails closed.
//
// THE ENTITLEMENT VERDICT IS APPLIED DIFFERENTLY TO THE TWO CALLERS, on purpose:
//
//   a PARTNER who is not entitled gets 403 and the reason. No curriculum, no
//   gate record, nothing — the check is in front of the data, not beside it.
//   a STAFF caller always gets the record, with the verdict inside it. The people
//   running the cohort have to be able to see why somebody is locked out, and a
//   trainer who cannot read a paused partner's gate history cannot answer the
//   question they were asked.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { resolvePartnerId, safeMessage } from "../../src/http/partner-read-api.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { trainingAccessFor, accessMessage } from "../../src/training/entitlement.mjs";
import { trainingViewFor } from "../../src/training/progress.mjs";

/* Exported so src/http/partner-training-read.test.mjs can drive the payload
   without an HTTP request. An endpoint whose query only ever runs behind a
   handler is one whose column names go unchecked until a partner opens the
   screen — the reason api/read/partner-production.mjs exports its fetch too. */
export async function fetchTraining(tx, { partnerId, orgId }) {
  /* The org is bound here and nowhere else. This is the C1 rule
     (src/http/read-endpoints-org-scope.test.mjs) and a real second lock, not a
     formality — see the header. */
  const partner = (await tx.query(
    `SELECT id, org_id, status, agreement_signed_at
       FROM partners
      WHERE id = $1 AND org_id = $2
      LIMIT 1`,
    [partnerId, orgId]
  )).rows[0];
  if (!partner) return null;

  const access = await trainingAccessFor(tx, { orgId, partnerId });
  const view = await trainingViewFor(tx, { orgId, partnerId });

  return {
    ...view,
    partner_status: partner.status,
    // NULL survives as NULL — an unsigned agreement is a real state, not a zero.
    agreement_signed_at: partner.agreement_signed_at,
    entitled: access.allowed,
    entitlement_reason: access.reason,
    entitlement_message: access.reason ? accessMessage(access.reason) : null
  };
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;

  if (req.method && req.method !== "GET") {
    /* The Allow header is not decoration here: scripts/journeys/extract.mjs
       reads it to work out which methods a handler answers, and a route with no
       method is published on the journey pages a non-coder reads as a dash. */
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db: database });
  if (!principal) return;

  const partnerId = resolvePartnerId(principal, req.query || {});
  if (!partnerId) {
    return res.status(400).json({
      ok: false, error: "partner_id_required",
      message: "staff sessions must name a partner_id; partner sessions are scoped to their own"
    });
  }

  const orgId = principal.orgId || principal.org_id || null;
  if (!orgId) {
    // FAIL CLOSED. A session with no company cannot be scoped to one, and a
    // default org would file one company's partner under another's curriculum.
    return res.status(403).json({ ok: false, error: "org_required" });
  }

  try {
    const view = await withPartnerScope({ kind: principal.kind, partnerId }, (tx) =>
      fetchTraining(tx, { partnerId, orgId }));

    if (!view) return res.status(404).json({ ok: false, error: "not_found" });

    if (principal.kind === "partner" && !view.entitled) {
      return res.status(403).json({
        ok: false,
        error: "not_entitled",
        reason: view.entitlement_reason,
        message: view.entitlement_message
      });
    }

    return res.status(200).json({ ok: true, ...view });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "query_failed", message: safeMessage(err) });
  }
}

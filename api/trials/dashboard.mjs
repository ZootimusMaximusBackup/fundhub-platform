// GET /api/trials/dashboard — the live screen a trial buyer watches for a week.
//
// WHO CAN READ IT. requirePrincipal(["partner","staff"]). A partner principal is
// scoped to its OWN partner id, resolved from the session and never from the
// query string — a ?partner_id= sent by a partner is IGNORED rather than
// honoured or rejected, because honouring it is the leak and rejecting it tells
// a prober whether the id they guessed exists. A staff caller must name a
// partner_id: answering a staff call with the union of every trial would make
// the same endpoint mean two different things depending on who called it.
//
// WHAT IT RETURNS. Counts of rows that exist, for this buyer, in this trial's
// window. Zero booked calls renders as zero. Spend is null — not zero — when
// nothing has synced from the platform yet, because "we have not heard from
// Meta" and "Meta says you spent nothing" are different facts.
//
// NO EARNINGS CLAIMS, NO BENCHMARKS, NO OTHER BUYER'S NUMBERS. Nothing on this
// response is a projection, a typical result or a range. There are zero
// measured paid closes on record, so there is nothing honest to compare against
// and nothing is invented to fill the gap.
//
// NO LENDER DATA. Partners never see lender bands, payout percentages or
// fulfilment playbooks, and none of them are selected by this endpoint.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { trialDashboard } from "../../src/trials/dashboard.mjs";
import { remedyPolicyText } from "../../src/trials/remedy.mjs";
import { safeError } from "../../src/http/health.mjs";

/* resolvePartnerId — the tenancy decision, made once, exactly as
   src/http/partner-read-api.mjs makes it. */
export function resolvePartnerId(principal, query = {}) {
  if (!principal) return null;
  if (principal.kind === "partner") return principal.partnerId || principal.partner_id || null;
  if (principal.kind === "staff") return query.partner_id || null;
  return null;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;

  if (req.method && req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db: database });
  if (!principal) return;

  const query = req.query || {};
  const partnerId = resolvePartnerId(principal, query);
  if (!partnerId) {
    return res.status(400).json({
      ok: false,
      error: "partner_id_required",
      message: "staff sessions must name a partner_id; partner sessions are scoped to their own"
    });
  }

  const orgId = principal.orgId || principal.org_id || (principal.staff && principal.staff.org_id) || null;
  if (!orgId) {
    return res.status(403).json({ ok: false, error: "forbidden", message: "session carries no org" });
  }

  try {
    const out = await trialDashboard(database, { orgId, partnerId });
    if (!out.ok) {
      // "You have no trial" is a 404, not an empty dashboard. An empty
      // dashboard reads as "your trial produced nothing".
      return res.status(404).json({ ok: false, error: out.reason || "no_trial" });
    }
    return res.status(200).json({
      ok: true,
      trial: out.trial,
      numbers: out.numbers,
      bookings: out.bookings,
      plan: out.plan,
      events: out.events,
      notes: out.notes,
      guarantee: remedyPolicyText(),
      // Said by the API rather than typed into the page, so it cannot be
      // softened on the screen without changing this file.
      limitation:
        "These are your own numbers, counted from real rows. We do not show averages, " +
        "typical results, or anybody else's trial, because we have not measured one."
    });
  } catch (err) {
    // A bad uuid in ?partner_id= is the caller's error, not an outage.
    if (err && typeof err.code === "string" && err.code.startsWith("22")) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

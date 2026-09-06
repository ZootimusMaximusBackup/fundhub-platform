// Lead temperature — cold/warm/hot classification for the N-01/02/03 nurture split.
//
// Darwin's call, not Chris's (flagged in workflow-migration-table.md for Chris to
// confirm or override): the CRM version tagged leads `nurture:cold/warm/hot` via an
// undocumented side-automation, and no source describes how that tag was actually
// assigned. outcome_tier can't stand in for it either — it's only set post
// decision.rendered, and most nurture targets never pay the $32 diagnostic that
// leads there. So temperature is derived purely from funnel depth, using events
// already in canonical.mjs. Kept in one config module (not inlined in the N-01/02/03
// workflow files) so the thresholds can change without touching workflow code.
//
// Re-run this on every one of TEMPERATURE_EVENTS for a lead so the bucket moves as
// they engage — a lead who was "cold" this morning and submits the survey this
// afternoon is "warm" by this afternoon's evaluation.

export const TEMPERATURE_EVENTS = [
  "entry.captured",
  "survey.submitted",
  "booking.created",
  "booking.cancelled",
  "booking.noshow",
  "call.completed",
  "diagnostic.paid"
];

// classifyTemperature — pure, no I/O. `seen` is the Set of canonical event names this
// lead has ever fired. Checks run deepest-funnel-first.
//
// Cancel / no-show decision (owner-set for this pass): if booking.cancelled or
// booking.noshow is present AND there is no still-standing booking.created /
// call.completed heat, fall back to warm (survey) or cold (entry). Sets do not
// carry order, so a lead who booked then cancelled looks the same as cancelled
// then rebooked — prefer cancel/noshow over booking.created when both appear,
// so a cancelled book does not stay "hot" forever. A later rebook emits a new
// booking.created; until then they re-enter nurture.
export function classifyTemperature(seen) {
  const has = (name) => seen.has(name);
  if (has("diagnostic.paid")) return null;
  const cancelled = has("booking.cancelled") || has("booking.noshow");
  if (cancelled && !has("call.completed")) {
    if (has("survey.submitted")) return "warm";
    if (has("entry.captured")) return "cold";
    return "cold";
  }
  if (has("booking.created") || has("call.completed")) return "hot";
  if (has("survey.submitted")) return "warm";
  if (has("entry.captured")) return "cold";
  return null;
}

// currentTemperature — look up which funnel-depth events this client has fired and
// classify. Returns "hot" | "warm" | "cold" | null.
export async function currentTemperature(db, clientId) {
  if (!clientId) return null;
  const r = await db.query(
    `SELECT DISTINCT name FROM events WHERE client_id = $1 AND name = ANY($2)`,
    [clientId, TEMPERATURE_EVENTS]
  );
  return classifyTemperature(new Set(r.rows.map((row) => row.name)));
}

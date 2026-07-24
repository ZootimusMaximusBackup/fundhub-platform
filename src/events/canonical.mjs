// Canonical event names — Master Rebuild Spec §4. Extend as needed, keep names.
// The journey spine + the side events every adapter can emit.
export const CANONICAL_EVENTS = [
  // journey spine
  "entry.captured",
  "survey.submitted",
  "diagnostic.paid", // $32
  "analysis.completed",
  "booking.created",
  "call.completed",
  "decision.rendered", // 6-tier outcome
  "deposit.paid",
  "sale.closed",
  "round.started",
  "round.submitted",
  "round.approved",
  "round.funded",
  "file.finalized",
  // side events
  "payment.received",
  "payment.failed",
  "docs.received",
  "inquiry.removed",
  "letter.generated",
  "message.inbound",
  "mail.response"
];

export const isCanonical = (name) => CANONICAL_EVENTS.includes(name);

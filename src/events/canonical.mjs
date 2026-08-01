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
  "mail.response",
  // outbound messaging (GHL cutover, Ticket 1). `message.queued` is emitted by
  // sendTemplated when a row is really written — a replayed event dedupes into
  // no row and so emits nothing. The other three are the dispatcher's terminal
  // outcomes. Nothing emits them yet; the dispatcher records to the messages
  // row and has no bus writes, so these are the names reserved for when it does.
  "message.queued",
  "message.sent",
  "message.failed",
  "message.blocked",
  // commission + billing (proposed in src/commissions/PROPOSED-EVENTS.md)
  "commission.earned",
  "commission.approved",
  "commission.paid",
  "invoice.created",
  "invoice.sent",
  "invoice.paid",
  "invoice.voided"
];

export const isCanonical = (name) => CANONICAL_EVENTS.includes(name);

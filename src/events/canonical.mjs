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
  // `message.queued` is emitted by sendTemplated when a row is really written —
  // a replayed event dedupes into no row and so emits nothing. The other three
  // are the dispatcher's terminal outcomes and have NO emitter yet: the
  // dispatcher records to the messages row and makes no bus writes, so these are
  // the names reserved for when it does. Do not assume they fire.
  //
  // Keep the line below short — scripts/diagrams/generate.mjs uses the comment
  // line immediately above a group as that group's section name in the table.
  // outbound messaging
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

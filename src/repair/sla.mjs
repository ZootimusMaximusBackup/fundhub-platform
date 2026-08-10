// SLA clocks → stalled. Spec CREDIT-REPAIR-PIPELINE-SPEC §5.

export const STAGE_SLA = Object.freeze({
  intake: { days: 3, businessDays: true, task: "chase_contract" },
  awaiting_documents: { days: 14, task: "owner_contact_client" },
  analysis: { hours: 1, task: "engineering_engine_failure" },
  letters_generated: { minutes: 30, task: "engineering_generation_or_variance" },
  ready_to_send: { hours: 4, task: "dispatch_failure" },
  in_transit: { days: 10, task: "check_postgrid_tracking" },
  awaiting_response: { daysAfterDue: 5, task: "bureau_deadline_breach" },
  response_received: { hours: 24, task: "owner_reviews_parse" }
});

export function isBreached({ stageKey, enteredAt, asOf, responseDueAt }) {
  const sla = STAGE_SLA[stageKey];
  if (!sla || !enteredAt) return { breached: false };
  const now = new Date(asOf || Date.now()).getTime();
  const start = new Date(enteredAt).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(start)) return { breached: false };

  if (sla.daysAfterDue != null) {
    if (!responseDueAt) return { breached: false };
    const due = new Date(responseDueAt).getTime() + sla.daysAfterDue * 86400000;
    return { breached: now > due, task: sla.task, sla };
  }
  let ms = 0;
  if (sla.minutes) ms = sla.minutes * 60000;
  else if (sla.hours) ms = sla.hours * 3600000;
  else if (sla.days) ms = sla.days * 86400000;
  return { breached: now > start + ms, task: sla.task, sla };
}

/** Stages that fail automation land here — the only human queue. */
export const STALLED_STAGE = "stalled";

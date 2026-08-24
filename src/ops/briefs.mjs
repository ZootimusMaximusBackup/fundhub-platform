// Two voices from the same pulse. No invented advice.
// If a number is missing, say it is missing.
//
// CEO: “What needs doing today?”
// Chris / owner: “What will be done.”

import { formatCents, formatRate } from "../dashboard/kpis.mjs";

function missing(label) {
  return `${label} is missing`;
}

function countLine(label, value, unit) {
  if (value == null) return missing(label);
  return `${label}: ${value}${unit ? ` ${unit}` : ""}`;
}

function barLine(bar, seatLabel, unit) {
  if (!bar) return missing(`${seatLabel} bar`);
  const target = bar.target == null ? "target is missing" : `target ${bar.target} ${unit}`;
  const actual = bar.actual == null
    ? (bar.missing ? `this month is missing (${bar.missing})` : "this month is missing")
    : `this month ${bar.actual} ${unit}`;
  return `${seatLabel}: ${target}. ${actual}.`;
}

function calendarLine(calendar) {
  if (!calendar) return "Calendar packed rule is missing.";
  const slots = calendar.slots_per_closer_day;
  const due = calendar.due_at_count;
  const closers = calendar.closer_count;
  if (calendar.reason === "no_closer_due_at") {
    return `Calendar: not packed. No closer tasks have a due time in the next ${calendar.window_weekdays} weekdays. MODEL rule (not a live stopwatch).`;
  }
  if (calendar.packed) {
    return `Calendar: packed. ${due} closer slots in the next ${calendar.window_weekdays} weekdays. ${closers} closer(s). ${slots} MODEL slots per closer per day. Hire a pod (closer + funding advisor). Do not hire a setter.`;
  }
  return `Calendar: not packed. ${due} closer slots vs a MODEL bar of ${calendar.threshold}. ${closers} closer(s).`;
}

export function ceoBrief(pulse) {
  const eight = pulse?.company_8 || {};
  const k = pulse?.kpis || {};
  const lines = [
    "What needs doing today?",
    "",
    countLine("New clients", eight.new_clients?.value),
    countLine("Booked calls", eight.booked_calls?.value),
    eight.show_rate?.missing ? missing("Show rate") : `Show rate: ${formatRate(k.show_rate)}`,
    eight.close_rate?.missing ? missing("Close rate") : `Close rate: ${formatRate(k.close_rate)}`,
    `Cash: ${formatCents(k.cash_collected_cents)}`,
    countLine("Funded files", eight.funded_count?.value),
    `Funded dollars: ${formatCents(k.funded_amount_cents)}`,
    eight.cost_per_funded_cents?.missing
      ? `Cost per funded is missing${eight.cost_per_funded_cents?.reason ? ` (${eight.cost_per_funded_cents.reason})` : ""}`
      : `Cost per funded: ${formatCents(k.cost_per_funded_cents)}`,
    "",
    barLine(pulse?.bars?.closer, "Closer starting bar (per pod, company scaled)", "deposits"),
    barLine(pulse?.bars?.funding_advisor, "Funding advisor starting bar (per pod, company scaled)", "funded files"),
    pulse?.pods
      ? `Pods: ${pulse.pods.complete} complete. ${pulse.pods.closer_count} closer(s) and ${pulse.pods.fa_count} funding advisor(s). They work in tandem.`
      : "Pods: count is missing.",
    "",
    calendarLine(pulse?.calendar),
    "",
    ...(pulse?.learning?.top?.length
      ? [
        "Discoveries (data, not guesses):",
        ...pulse.learning.top.map((d, i) => `${i + 1}. ${d.headline} ${d.detail}`),
        `Learned ${pulse.learning.learned}. Not enough data ${pulse.learning.blocked}. Need ${pulse.learning.min_n_rate} for a rate, ${pulse.learning.min_n_time} timed calls for minutes.`,
        ""
      ]
      : ["Discoveries: none yet.", ""]),
    ...(pulse?.gaps?.notes?.length ? ["Gaps:", ...pulse.gaps.notes, ""] : ["Gaps: no gap note yet.", ""]),
    pulse?.hire?.profile?.lines?.length
      ? `Hire profile: ${pulse.hire.profile.lines.join(" ")}`
      : "Hire profile: none this month.",
    pulse?.hire?.recommend
      ? "Needs doing: create the hire-pod task and post the LinkedIn closer job (once this month). The funding advisor is the other half of the pod."
      : "Needs doing: no hire this month from the packed rule.",
    pulse?.ads?.status === "ok"
      ? `Ad spend this window: ${formatCents(pulse.ads.spend_cents)}. Read only. Do not buy ads from here.`
      : `Ad spend is ${pulse?.ads?.status || "missing"}.`,
    pulse?.fire?.rule_locked
      ? "Fire: a locked rule exists. That is a C-suite task only. The brain does not kick anyone out."
      : "Fire: no fire rule yet. Do not invent one. The brain does not kick anyone out of the CRM.",
    "Raise: no raise rule yet. Do not invent a percent.",
    "Bonus: no bonus rule yet. Do not invent a dollar amount."
  ];
  return lines.join("\n");
}

export function ownerBrief(pulse) {
  const cal = pulse?.calendar || {};
  const hire = pulse?.hire || {};
  const li = hire.linkedin || {};
  const lines = [
    "What will be done.",
    "",
    "Watch the eight company numbers. They are company health, not eight scores per person.",
    pulse?.learning?.top?.[0]
      ? `Top discovery: ${pulse.learning.top[0].headline} Do not overwrite MODEL times until n is enough.`
      : "No discovery yet. We learn when the counts are big enough. We do not invent averages.",
    cal.packed
      ? "The calendar is packed (MODEL count). Create one hire-pod task this month (closer + funding advisor) and post the LinkedIn closer job. Do not hire a setter."
      : "The calendar is not packed. Do not create a hire task from this pulse unless a pod is uneven.",
    hire.existing_task_id
      ? `Hire task already on file (${hire.existing_task_id}).`
      : "No hire task on file for this month yet.",
    `LinkedIn: ${li.status || "unknown"}. Reuses the existing hiring job-post path.`,
    "A person still has to send an invite. Marking hired does not create a login.",
    "",
    pulse?.gaps?.has_short
      ? "Write one look-at-gaps task this month when a seat is short."
      : "No gap to-do this month unless a seat is short.",
    pulse?.ads?.status === "ok" && pulse.ads.spend_cents > 0
      ? "Write one look-at-ads task this month. Do not pause or buy ads."
      : "No ads review task unless a real spend number is on file.",
    pulse?.fire?.rule_locked
      ? "If a fire decision is needed, write a C-suite task to the owner. Do not suspend or revoke anyone from here."
      : "No fire rule yet, so no fire task will be created.",
    "No raise rule yet. No bonus rule yet. Pay does not move from here."
  ];
  return lines.join("\n");
}

export function briefsFromPulse(pulse) {
  return {
    ceo: ceoBrief(pulse),
    owner: ownerBrief(pulse)
  };
}

export default briefsFromPulse;

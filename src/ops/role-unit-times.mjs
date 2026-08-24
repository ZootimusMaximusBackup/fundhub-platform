// One job = one unit. How long a seat spends on ONE of those jobs.
//
// Minutes are MODEL defaults (Grok-set 2026-08-24). Not live-timed from
// call_outcomes or a bank fill. Live DB still has 0 durations — that is a
// note, not a reason to leave desk_minutes blank.
//
// Work month: 8 hours/day × 20 days = 160 desk hours.

export const HOURS_PER_DAY = 8;
export const WORK_DAYS_PER_MONTH = 20;
export const DESK_HOURS_PER_MONTH = HOURS_PER_DAY * WORK_DAYS_PER_MONTH;
export const DEFAULT_APPS_PER_ROUND = 5;
export const DEFAULT_ROUNDS_PER_FILE = 3.5;

export const CC_APPLICATION_MINUTES = 10;
// N apps × cc_application minutes
export const FUNDING_ROUND_MINUTES = DEFAULT_APPS_PER_ROUND * CC_APPLICATION_MINUTES;
export const FUNDED_FILE_MINUTES = DEFAULT_ROUNDS_PER_FILE * FUNDING_ROUND_MINUTES;
export const REPAIR_CLIENT_ROUND_MINUTES = 5;
export const INQUIRY_FTC_UPLOAD_MINUTES = 2;
export const CLOSER_LOGGED_CALL_MINUTES = 45;
export const FTC_PDF_OBTAIN_MINUTES = 15;

const SOURCE = "MODEL";

export const ROLE_UNITS = Object.freeze([
  Object.freeze({
    id: "cc_application",
    role: "funding_advisor",
    unit: "1 credit card application",
    steps: Object.freeze([
      "Open lenders for that client",
      "Press Apply (opens the bank site)",
      "Fill the bank form — not a Fundhub form",
      "Come back and move the card to Round submitted when the pack is in"
    ]),
    fundhub_clicks: 2,
    outside_fundhub: true,
    desk_minutes: CC_APPLICATION_MINUTES,
    source: SOURCE,
    why_null: null
  }),
  Object.freeze({
    id: "funding_round",
    role: "funding_advisor",
    unit: "1 funding round",
    steps: Object.freeze([
      "Move the card to Apply now (starts the round)",
      "One credit-card application per card in the round",
      "Move the card to Round submitted"
    ]),
    fundhub_clicks: "2 + N applies",
    outside_fundhub: true,
    // N apps × cc_application minutes (DEFAULT_APPS_PER_ROUND = 5)
    desk_minutes: FUNDING_ROUND_MINUTES,
    source: SOURCE,
    why_null: null
  }),
  Object.freeze({
    id: "repair_client_round",
    role: "inquiry_specialist",
    unit: "1 repair client, one round, letters already made",
    steps: Object.freeze([
      "Open Specialist desk",
      "Press Repair",
      "Open the file",
      "Press Send"
    ]),
    fundhub_clicks: 4,
    outside_fundhub: false,
    desk_minutes: REPAIR_CLIENT_ROUND_MINUTES,
    source: SOURCE,
    why_null: null
  }),
  Object.freeze({
    id: "inquiry_ftc_upload",
    role: "inquiry_specialist",
    unit: "1 FTC or police report upload",
    steps: Object.freeze([
      "Open Inquiries",
      "Open the case",
      "Choose the file already on the computer",
      "Press Upload FTC or police report"
    ]),
    fundhub_clicks: 4,
    outside_fundhub: false,
    desk_minutes: INQUIRY_FTC_UPLOAD_MINUTES,
    source: SOURCE,
    why_null: null,
    note: "Fundhub never files the FTC report. Getting the report is FTC_PDF_OBTAIN_MINUTES (15)."
  }),
  Object.freeze({
    id: "closer_logged_call",
    role: "closer",
    unit: "1 logged close call",
    steps: Object.freeze([
      "Open the call",
      "Present",
      "Log the outcome (deposit / downsell / callback / no-show / not a fit)"
    ]),
    fundhub_clicks: 3,
    outside_fundhub: true,
    desk_minutes: CLOSER_LOGGED_CALL_MINUTES,
    source: SOURCE,
    why_null: null
  })
]);

export function unitById(id) {
  return ROLE_UNITS.find((u) => u.id === id) || null;
}

export function unitsForRole(role) {
  return ROLE_UNITS.filter((u) => u.role === role);
}

/**
 * Hours a seat needs for a count of units.
 * Returns a number when the unit has desk minutes. Bad id or count → null.
 */
export function hoursForUnits(unitId, count) {
  const unit = unitById(unitId);
  const n = Number(count);
  if (!unit || !Number.isFinite(n) || n < 0) return null;
  if (unit.desk_minutes == null) return null;
  return (n * unit.desk_minutes) / 60;
}

/** Hours for a funding round of N card apps (uses cc_application minutes × N). */
export function hoursForFundingRound(appCount = DEFAULT_APPS_PER_ROUND) {
  return hoursForUnits("cc_application", appCount);
}

/**
 * How many of that job fit in a work month.
 * monthlyMax(minutes) = floor(hours * 60 / minutes)
 */
export function monthlyMax(deskMinutes, { hours = DESK_HOURS_PER_MONTH } = {}) {
  const minutes = Number(deskMinutes);
  const h = Number(hours);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (!Number.isFinite(h) || h < 0) return null;
  return Math.floor((h * 60) / minutes);
}

const HALF_HOURS = DESK_HOURS_PER_MONTH / 2;

function capacityRow(row) {
  return Object.freeze({
    ...row,
    theoretical_max: monthlyMax(row.minutes),
    half_time_max: monthlyMax(row.minutes, { hours: HALF_HOURS })
  });
}

export const CAPACITY = Object.freeze([
  capacityRow({
    seat: "closer",
    id: "closer_logged_call",
    unit: "1 logged close call",
    minutes: CLOSER_LOGGED_CALL_MINUTES
  }),
  capacityRow({
    seat: "closer",
    id: "closer_deposit",
    unit: "1 deposit (only if every call deposits)",
    minutes: CLOSER_LOGGED_CALL_MINUTES
  }),
  capacityRow({
    seat: "funding_advisor",
    id: "cc_application",
    unit: "1 credit card application",
    minutes: CC_APPLICATION_MINUTES
  }),
  capacityRow({
    seat: "funding_advisor",
    id: "funding_round",
    unit: "1 funding round",
    minutes: FUNDING_ROUND_MINUTES
  }),
  capacityRow({
    seat: "funding_advisor",
    id: "funded_file",
    unit: "1 funded file (3.5 rounds)",
    minutes: FUNDED_FILE_MINUTES
  }),
  capacityRow({
    seat: "inquiry_specialist",
    id: "repair_client_round",
    unit: "1 repair client, letters already made",
    minutes: REPAIR_CLIENT_ROUND_MINUTES
  }),
  capacityRow({
    seat: "inquiry_specialist",
    id: "inquiry_ftc_upload",
    unit: "1 FTC or police report upload",
    minutes: INQUIRY_FTC_UPLOAD_MINUTES
  }),
  capacityRow({
    seat: "inquiry_specialist",
    id: "ftc_pdf_obtain",
    unit: "1 FTC or police PDF (get and save — not the upload)",
    minutes: FTC_PDF_OBTAIN_MINUTES
  })
]);

// Starting bars. AI-set 2026-08-24. One pod = one closer + one FA in tandem.
// Per pod: 27 deposits and 27 funded files. That is half the FA time-max (54).
// The FA desk is the bottleneck. The closer bar matches so they stay in lockstep.
// Company bar = 27 × complete pods. Not a spoken 20. Not the time-max.
export const STARTING_BARS = Object.freeze({
  closer_deposits: 27,
  funding_advisor_files: 27,
  per: "pod",
  source: SOURCE,
  set_by: "model-pod-2026-08-24"
});

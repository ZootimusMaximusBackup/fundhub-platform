// Interview Meet booking helpers. No outbound calls — Cal.com already
// creates the Google Meet URL and posts it on booking.created.

const URL_RE = /^https?:\/\//i;

export function isInterviewBooking(payload = {}) {
  const blob = [
    payload.eventTypeSlug,
    payload.eventTypeTitle,
    payload.eventType,
    payload.title
  ].filter(Boolean).join(" ");
  return /interview|post-fund|insight/i.test(blob);
}

function pickUrl(env, key) {
  const u = String(env[key] || "").trim();
  return URL_RE.test(u) ? u : null;
}

/** Cal.com (or CF) link the funding advisor sends for the post-funding interview. */
export function meetBookingUrl(env = process.env) {
  return pickUrl(env, "INSIGHT_MEET_BOOKING_URL");
}

/** Sales-call booking page — clients book the strategy session here (Meet via Cal.com). */
export function salesMeetBookingUrl(env = process.env) {
  return pickUrl(env, "SALES_MEET_BOOKING_URL")
    || "https://apply.fundhub.ai/funding-book-call";
}

export const RECORDING_NOTE =
  "Click Record in Google Meet. The file lands in Google Drive (Meet Recordings). Fundhub stores the Drive link.";

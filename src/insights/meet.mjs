// Interview Meet booking helpers. No outbound calls — Cal.com already
// creates the Google Meet URL and posts it on booking.created.

export function isInterviewBooking(payload = {}) {
  const blob = [
    payload.eventTypeSlug,
    payload.eventTypeTitle,
    payload.eventType,
    payload.title
  ].filter(Boolean).join(" ");
  return /interview|post-fund|insight/i.test(blob);
}

export function meetBookingUrl(env = process.env) {
  const u = String(env.INSIGHT_MEET_BOOKING_URL || "").trim();
  return /^https?:\/\//i.test(u) ? u : null;
}

export const RECORDING_NOTE =
  "Click Record in Google Meet. The file lands in Google Drive (Meet Recordings). Fundhub stores the Drive link.";

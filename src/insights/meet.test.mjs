import { test } from "node:test";
import assert from "node:assert/strict";
import { isInterviewBooking, meetBookingUrl, salesMeetBookingUrl } from "./meet.mjs";

test("isInterviewBooking: matches interview event types only", () => {
  assert.equal(isInterviewBooking({ eventTypeSlug: "post-funding-interview" }), true);
  assert.equal(isInterviewBooking({ eventTypeTitle: "Insight interview" }), true);
  assert.equal(isInterviewBooking({ eventTypeSlug: "strategy-session" }), false);
  assert.equal(isInterviewBooking({}), false);
});

test("meetBookingUrl: only a real http(s) link", () => {
  assert.equal(meetBookingUrl({ INSIGHT_MEET_BOOKING_URL: "https://apply.fundhub.ai/funding-book-call" }),
    "https://apply.fundhub.ai/funding-book-call");
  assert.equal(meetBookingUrl({ INSIGHT_MEET_BOOKING_URL: "" }), null);
  assert.equal(meetBookingUrl({ INSIGHT_MEET_BOOKING_URL: "not-a-url" }), null);
});

test("salesMeetBookingUrl: env override or apply funnel default", () => {
  assert.equal(
    salesMeetBookingUrl({ SALES_MEET_BOOKING_URL: "https://apply.fundhub.ai/funding-book-call" }),
    "https://apply.fundhub.ai/funding-book-call"
  );
  assert.equal(salesMeetBookingUrl({}), "https://apply.fundhub.ai/funding-book-call");
});

// Portal invite on booking — RETIRED at the book moment (owner 2026-08-23).
// EMAIL-PORTAL-MAGIC-LINK still fires when a client asks for a login link
// (src/auth/magic-link.mjs via /api/auth/magic-link). Booking confirm
// (S-04B / EMAIL-S04-01-CONFIRM) now carries portal access instead.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";

export const LOCK_FIELD = "portal_invite_sent_at";

export async function handle() {
  return { done: false, reason: "owned_by_s04b" };
}

export const sPortalInvite = inngest.createFunction(
  { id: "s-portal-invite", name: "S-PORTAL — Booking Portal Invite" },
  { event: "booking.created" },
  ({ event, step }) => handle({ event: event.data, db, step })
);

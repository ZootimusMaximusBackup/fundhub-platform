// S-NOBOOK — Fall-off chase when survey is done but they never booked.
// Owner 2026-08-15: three SMS, rebook link, no video / meme assets required.
// Text can mention "results" in plain language; MMS media is optional later.
//
// Trigger: survey.submitted. Exits when booking.created appears for the client.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";

export const SMS_NOBOOK_01 = "SMS-NOBOOK-01";
export const SMS_NOBOOK_02 = "SMS-NOBOOK-02";
export const SMS_NOBOOK_03 = "SMS-NOBOOK-03";

async function hasBooked(db, clientId) {
  const r = await db.query(
    `SELECT DISTINCT name FROM events WHERE client_id = $1 AND name = ANY($2)`,
    [clientId, ["booking.created"]]
  );
  return r.rows.some((row) => row.name === "booking.created");
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  // Already booked by the time we wake — common if they book on the thank-you page.
  if (await step.run("check-already-booked", () => hasBooked(db, clientId))) {
    return { done: true, exitedAt: "already_booked" };
  }

  const orgId = event.orgId;
  const eventId = event.id;

  await step.sleep("wait-2h", "2h");
  if (await step.run("check-booked-1", () => hasBooked(db, clientId))) {
    return { done: true, exitedAt: "after-wait-2h" };
  }
  const msg1 = await step.run("send-nobook-1", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_NOBOOK_01,
      eventId: `${eventId}:1`
    }));

  await step.sleep("wait-24h", "24h");
  if (await step.run("check-booked-2", () => hasBooked(db, clientId))) {
    return { done: true, exitedAt: "after-msg1", msg1 };
  }
  const msg2 = await step.run("send-nobook-2", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_NOBOOK_02,
      eventId: `${eventId}:2`
    }));

  await step.sleep("wait-72h", "72h");
  if (await step.run("check-booked-3", () => hasBooked(db, clientId))) {
    return { done: true, exitedAt: "after-msg2", msg1, msg2 };
  }
  const msg3 = await step.run("send-nobook-3", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_NOBOOK_03,
      eventId: `${eventId}:3`
    }));

  return { done: true, exitedAt: "completed", msg1, msg2, msg3 };
}

export const sNobookChase = inngest.createFunction(
  { id: "s-nobook-chase", name: "S-NOBOOK — Never Booked Chase" },
  { event: "survey.submitted" },
  ({ event, step }) => handle({ event: event.data, db, step })
);

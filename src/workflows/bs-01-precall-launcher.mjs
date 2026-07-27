// BS-01 — Pre-Call Backend Launcher.
// Source: GHL-System-Map.md BACK-END SELLING section.
// Merges in BS-EMAIL-FUNDING-72HR (live) and BS-EMAIL-REPAIR-72HR (live): both are
// "Add to workflow" targets BS-01 enrolls into, not independently-triggered
// workflows, so they're one continuous flow here rather than three separate files.
// The [AGENT DRAFT] BS-EMAIL-FUNDING-72HR duplicate (identical subjects, same
// sequence) is RETIRED per spec §6's explicit note — this ports the "(live)" copy.
//
// Wait durations aren't specified anywhere read for this port (just "Wait", no
// number) — spaced at 4h between touches as a reasonable midday-to-evening cadence
// (a timing choice, logged in workflow-migration-table.md, not a business rule).
//
// Trigger: booking.created. Gate: product path decides which drip runs (Funding vs
// Repair variant) — Rule 4-compliant (categorical path, not a dollar amount).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { clientOutcomeTier, isFundingPath, isRepairOnlyPath } from "../config/product-path.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";

export const FUNDING_TEMPLATES = ["EMAIL-BS-FUND-01-KICKOFF", "EMAIL-BS-FUND-02-MORNING", "EMAIL-BS-FUND-03-MIDDAY", "EMAIL-BS-FUND-04-AFTERNOON", "EMAIL-BS-FUND-05-EVENING"];
export const REPAIR_TEMPLATES = ["EMAIL-BS-REPAIR-00-START", "EMAIL-BS-REPAIR-01-MORNING", "EMAIL-BS-REPAIR-02-MIDMORNING", "EMAIL-BS-REPAIR-03-LUNCH", "EMAIL-BS-REPAIR-04-AFTERNOON", "EMAIL-BS-REPAIR-05-EVENING"];

async function runDrip({ db, step, orgId, clientId, eventId, templateKeys }) {
  const sent = [];
  for (let i = 0; i < templateKeys.length; i++) {
    if (i > 0) await step.sleep(`wait-${i}`, "4h");
    const res = await step.run(`send-${i}`, () =>
      sendTemplated(db, { orgId, clientId, channel: "email", templateKey: templateKeys[i], eventId: `${eventId}:${i}` }));
    sent.push(res);
    await step.run(`stamp-last-sent-${i}`, () => mergeCustomFields(db, clientId, { bs_email_last_sent_ts: new Date().toISOString() }));
  }
  return sent;
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  await step.run("tag-precall", () => addTags(db, clientId, ["bs:precall"]));
  await step.run("set-precall-start", () => mergeCustomFields(db, clientId, { bs_precall_start_ts: new Date().toISOString() }));

  const outcomeTier = await step.run("check-product-path", () => clientOutcomeTier(db, clientId));
  let drip;
  if (isFundingPath(outcomeTier)) drip = FUNDING_TEMPLATES;
  else if (isRepairOnlyPath(outcomeTier)) drip = REPAIR_TEMPLATES;
  else return { done: true, drip: "none", reason: `no_matching_path:${outcomeTier}` };

  const sent = await runDrip({ db, step, orgId, clientId, eventId, templateKeys: drip });
  await step.run("tag-call-booked", () => addTags(db, clientId, ["call:booked"]));

  return { done: true, drip: drip === FUNDING_TEMPLATES ? "funding" : "repair", sent };
}

export const bs01PrecallLauncher = inngest.createFunction(
  { id: "bs-01-precall-launcher", name: "BS-01 — Pre-Call Backend Launcher" },
  { event: "booking.created" },
  ({ event, step }) => handle({ event: event.data, db, step })
);

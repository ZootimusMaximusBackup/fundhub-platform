import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { onBureauResponseDocsReceived } from "../repair/response-agent.mjs";

export async function handle({ event, db: database }) {
  return onBureauResponseDocsReceived(database || db, event);
}

export const repairBureauResponseReader = inngest.createFunction(
  { id: "repair-bureau-response-reader", name: "Repair — Bureau Response Reader" },
  [{ event: "docs.received" }],
  ({ event, step }) => step.run("read-bureau-response", () => handle({ event: event.data, db }))
);

// GHL-DOC — Document Check on docs.received.
// Trigger rewired from GHL-era tag docs:uploaded. Spec 4.6 routes
// accept / request_more / hold inside src/handlers/ghl-doc.mjs.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { onDocsReceivedGhlDoc } from "../handlers/ghl-doc.mjs";

export async function handle({ event, db: database, ...deps }) {
  return onDocsReceivedGhlDoc(database || db, event, deps);
}

export const ghlDocDocumentCheck = inngest.createFunction(
  { id: "ghl-doc-document-check", name: "GHL-DOC — Document Check" },
  { event: "docs.received" },
  ({ event, step }) => step.run("run-ghl-doc", () => handle({ event: event.data, db }))
);

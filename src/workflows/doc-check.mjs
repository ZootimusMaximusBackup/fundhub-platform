// DOC-CHECK — Document Check on docs.received.
// Trigger rewired from GHL-era tag docs:uploaded. Spec 4.6 routes
// accept / request_more / hold inside src/handlers/doc-check.mjs.
//
// Renamed from ghl-doc-document-check by
// db/migrations/310_doc_check_verified_identity.sql, which also moves the
// agent row's code to DOC-CHECK and its runtime_ref to doc-check. GoHighLevel
// is out; this function has only ever run on Inngest in this repository.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { onDocsReceivedDocCheck } from "../handlers/doc-check.mjs";

export async function handle({ event, db: database, ...deps }) {
  return onDocsReceivedDocCheck(database || db, event, deps);
}

export const docCheck = inngest.createFunction(
  { id: "doc-check", name: "DOC-CHECK — Document Check" },
  { event: "docs.received" },
  ({ event, step }) => step.run("run-doc-check", () => handle({ event: event.data, db }))
);

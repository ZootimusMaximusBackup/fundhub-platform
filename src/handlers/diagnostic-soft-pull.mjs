// Sync soft-pull on diagnostic.paid.
//
// C-00 is an Inngest function. Until INNGEST_EVENT_KEY is on, that path never
// runs — money clears, the board stays empty, and nobody pulls credit. Same
// reason entry.captured places the sales card in-process: the CRM must update
// when the bytes land, not when a separate engine wakes up.
//
// Reuses C-00's handle() so consent, ledger, and CRS order stay one code path.
// Idempotency keys on the soft-pull ledger collapse double-fires if Inngest
// also runs later.

import { on } from "../events/registry.mjs";
import { handle as runC00 } from "../workflows/c-00-crs-soft-pull-request.mjs";

function syncStep() {
  return {
    run: async (_name, fn) => fn()
  };
}

export async function onDiagnosticPaidSoftPull(event, db, env = process.env) {
  if (!event?.orgId) return { ok: false, reason: "no_org" };
  return runC00({
    event,
    db,
    step: syncStep(),
    env
  });
}

export function register() {
  on("diagnostic.paid", onDiagnosticPaidSoftPull);
}

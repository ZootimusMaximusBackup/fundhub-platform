# T6 — the "Test against the code" button can fire real automations

Found 2026-08-19 while reproducing T6-09. NOT in the original audit list.

## What the screen promises
Journeys → "Test against the code" reports: "Nothing was saved — the run was undone."
api/journeys/run.mjs wraps the whole run in one transaction that is always rolled back
in a `finally`.

## What actually happens
The rollback covers the database. It does not cover the network.

  src/journeys/runner/index.mjs:132
      const res = await emit(db, name, { ...payload }, { orgId, clientId });
      ^ no skipInngest option

  src/events/bus.mjs:49-53
      if (process.env.INNGEST_EVENT_KEY && opts.skipInngest !== true) {
        void inngest.send({ name, data: { id, payload, orgId, clientId } }).catch(() => {});
      }

  Production env (verified by name via `netlify env:list --context production`, 2026-08-19):
      INNGEST_EVENT_KEY   : SET
      INNGEST_SIGNING_KEY : SET

So every event the walk fires is also sent to Inngest Cloud, outside the transaction.
Inngest can invoke the real workflow against the real database, minutes later,
after the run's transaction has already rolled back.

## Why it was safe when it was written
The runner's header lists what is not real: "time (a virtual clock) and the last inch
of a send (the memory provider). Those are the only two." That was true when
INNGEST_EVENT_KEY was unset — which is still what the comments in netlify.toml:51,
api/read/workflows.mjs:13-16 and api/inngest.mjs:9 claim today. The key was turned on
later. The harness silently became live.

## Fix
Pass skipInngest: true in the runner's emit call. The runner already invokes each
workflow directly through registry.byEvent, so the Inngest fan-out adds no coverage —
it only adds real-world side effects.

## Consequence for this thread
Do NOT run "Test against the code" against https://fundhub.ai until this ships.
T6-09 was therefore reproduced against a local database, not live.

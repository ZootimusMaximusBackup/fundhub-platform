#!/usr/bin/env node
// Drain the dead-letter queue — re-run handler failures whose backoff has expired.
//
// WHY THIS EXISTS. 039_failed_events.sql and src/events/dead-letter.mjs give
// every handler failure a row, an attempt count and a backoff schedule
// (1m, 5m, 15m, 1h, 6h, 24h — MAX_ATTEMPTS 7). Nothing ever called retryDue() or
// retryOne(), so the queue only ever filled up: a transient database blip during
// a payment handler meant that payment was never processed, and the row sat
// pending forever with an attempt count of 1. The retry machinery was built,
// tested, and never run.
//
// This is the runner. It is a SCRIPT rather than an Inngest scheduled function
// on purpose: the Inngest functions are inert until INNGEST_EVENT_KEY is set,
// and that is an operator decision that has not been made yet. A cron entry
// calling this works today, with or without Inngest.
//
//   DATABASE_URL=... node scripts/drain-dead-letters.mjs [--limit 50] [--dry-run]
//
// Exit codes: 0 nothing left needing attention, 1 rows are exhausted and need a
// human, 2 the run itself failed. Safe to run concurrently with the app — retry
// re-dispatches through the same handler the event originally used, and every
// money handler is idempotent (that is the standing rule), so a row that
// actually succeeded the first time will not double-apply.

import { db, close } from "../src/db.mjs";
import { retryDue, summary, handlerName } from "../src/events/dead-letter.mjs";
import { getHandlers } from "../src/events/registry.mjs";
import { ensureRegistered } from "../src/register-all.mjs";
import { resolveDefaultOrg } from "../src/auth/org.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const DRY = process.argv.includes("--dry-run");
const LIMIT = Math.max(1, Math.min(parseInt(arg("--limit", "50"), 10) || 50, 500));

/* resolveHandler — name -> function, from the SAME registry the bus dispatches
   through, so a retry runs exactly what originally failed. A name that no longer
   resolves is a code change rather than a transient fault, and dead-letter.mjs
   exhausts that row instead of retrying forever. */
function resolveHandler(wantName, eventName) {
  const handlers = getHandlers(eventName) || [];
  // Derive the name EXACTLY as bus.mjs does when it records the failure —
  // including its index-based fallback for anonymous handlers — or a row
  // recorded as "handler[1]:payment.received" would never match and would be
  // exhausted as unresolvable despite its handler still being registered.
  for (let i = 0; i < handlers.length; i++) {
    if (handlerName(handlers[i], `handler[${i}]:${eventName}`) === wantName) {
      return handlers[i];
    }
  }
  return null;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — nothing to drain.");
    return 2;
  }
  ensureRegistered();
  const orgId = await resolveDefaultOrg(db);

  const before = await summary(db, { orgId });
  console.log("queue before:", JSON.stringify(before));

  if (DRY) {
    console.log("--dry-run: no retries attempted.");
    return (before.counts && before.counts.exhausted) > 0 ? 1 : 0;
  }

  const out = await retryDue(db, resolveHandler, { orgId, limit: LIMIT });
  console.log(
    `attempted ${out.attempted} · resolved ${out.resolved} · rescheduled ${out.rescheduled} ` +
    `· exhausted ${out.exhausted} · unresolvable ${out.unresolvable}`
  );
  for (const r of out.results) {
    if (r.outcome !== "resolved") console.log(`  ${r.outcome}  ${r.id}`);
  }

  const after = await summary(db, { orgId });
  console.log("queue after: ", JSON.stringify(after));

  // Exhausted rows have run out of automatic attempts; they need a person.
  const stuck = (after.counts && after.counts.exhausted) || 0;
  if (stuck > 0) {
    console.log(`\n${stuck} row(s) EXHAUSTED — these need a human. ` +
                `Ops & Admin lists them, or: SELECT * FROM v_failed_events_summary;`);
    return 1;
  }
  return 0;
}

let code = 2;
try {
  code = await main();
} catch (err) {
  console.error("drain failed:", err && err.message);
} finally {
  await close();
}
process.exit(code);

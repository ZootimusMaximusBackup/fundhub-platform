#!/usr/bin/env node
// scripts/sim/stop-nobook-chase.mjs — owner-run stop for the runaway S-NOBOOK chase (F39, 2026-09-03).
//
//   DATABASE_URL="$(netlify env:get DATABASE_URL --context production)" node scripts/sim/stop-nobook-chase.mjs
//
// Why: funnel booking.created events carry no client_id, so src/workflows/s-nobook-chase.mjs
// can never see that a client booked and keeps texting them on every wake (2h / 24h / 72h).
// What this does, for the +sim-0N clients ONLY:
//   1. blocks any still-queued SMS-NOBOOK-* rows so the dispatcher never sends them
//   2. records a booking.created event ON each sim client, so every sleeping chase run
//      takes its own "already booked" exit when it wakes
// It does not touch real clients and does not change the workflow. Safe to re-run.

import { db, close } from "../../src/db.mjs";

const sims = await db.query(
  `select id, org_id, email from clients where email like 'stanbridgejchris+sim-0_@gmail.com'`
);
console.log("sim clients:", sims.rows.length);

const blocked = await db.query(
  `update messages
      set status = 'blocked',
          blocked_reason = 'owner-stop 2026-09-03: runaway S-NOBOOK chase (F39)',
          blocked_at = now(),
          updated_at = now()
    where template_key like 'SMS-NOBOOK-%'
      and status = 'queued'
      and client_id = any($1)
    returning id`,
  [sims.rows.map((r) => r.id)]
);
console.log("queued NOBOOK texts blocked:", blocked.rowCount);

let added = 0;
for (const c of sims.rows) {
  const has = await db.query(
    `select 1 from events where client_id = $1 and name = 'booking.created' limit 1`,
    [c.id]
  );
  if (has.rows.length) continue;
  await db.query(
    `insert into events (org_id, client_id, name, payload)
     values ($1, $2, 'booking.created', $3::jsonb)`,
    [
      c.org_id,
      c.id,
      JSON.stringify({
        source: "owner-stop",
        note: "F39: funnel booking.created rows carry no client_id; this row lets s-nobook-chase exit",
        email: c.email
      })
    ]
  );
  added++;
}
console.log("booking.created exit rows added:", added);
await close();

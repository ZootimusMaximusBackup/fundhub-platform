#!/usr/bin/env node
// One-shot backfill: every client with an email and no ghl_contact_id gets a
// GHL contact found-or-created (src/messaging/ghl-contacts.mjs), then stored.
//
// REQUIRES DATABASE_URL. REQUIRES GHL_API_KEY (preferred) or GHL_RELAY_API_KEY
// to be set — with neither set, ensureGhlContactId reports "not_configured"
// for every row rather than inventing a credential; this script counts that
// as skipped_no_key and exits 1 so it cannot be mistaken for a real backfill.
//
//   node scripts/backfill-ghl-contact-ids.mjs              # dry-run (default)
//   node scripts/backfill-ghl-contact-ids.mjs --dry-run    # same, explicit
//   node scripts/backfill-ghl-contact-ids.mjs --write      # apply the UPDATEs
//
// Dry-run still calls GHL (find-or-create is not free), it just skips the
// UPDATE — so a dry-run run is the accurate preview of what --write will do,
// not a guess.

import { db, close } from "../src/db.mjs";
import { ensureGhlContactId, config } from "../src/messaging/ghl-contacts.mjs";

const WRITE = process.argv.includes("--write");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const cfg = config(process.env);
  if (!cfg.ok) {
    console.error(`GHL API key unset: neither ${cfg.missing.join(" nor ")} is set.`);
    console.error("Set GHL_API_KEY (preferred) or GHL_RELAY_API_KEY, then re-run.");
    process.exit(1);
  }

  const { rows } = await db.query(
    `SELECT id, email, phone, first_name, last_name
       FROM clients
      WHERE ghl_contact_id IS NULL
        AND email IS NOT NULL
        AND email <> ''
      ORDER BY created_at ASC
      LIMIT 5000`
  );

  let scanned = 0, would_update = 0, updated = 0, skipped_no_key = 0, errors = 0;
  for (const c of rows) {
    scanned += 1;
    try {
      const r = await ensureGhlContactId(db, c, { dryRun: !WRITE });
      if (!r.ok) {
        if (r.reason === "not_configured") skipped_no_key += 1;
        console.warn(`skip ${c.id}: ${r.reason}`);
        continue;
      }
      would_update += 1;
      if (r.updated) {
        updated += 1;
        console.log(`updated ${c.id} -> ${r.contactId}`);
      } else {
        console.log(`would update ${c.id} -> ${r.contactId}`);
      }
    } catch (err) {
      // ensureGhlContactId itself never throws — this is belt-and-suspenders
      // for anything unexpected between rows (e.g. a dropped db connection).
      errors += 1;
      console.error(`error ${c.id}:`, (err && err.message) || err);
    }
  }

  console.log(JSON.stringify({
    mode: WRITE ? "write" : "dry-run",
    scanned, would_update, updated, skipped_no_key, errors
  }, null, 2));
}

main()
  .then(() => close())
  .catch(async (err) => {
    console.error(err);
    await close().catch(() => {});
    process.exit(1);
  });

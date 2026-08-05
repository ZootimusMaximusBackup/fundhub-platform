#!/usr/bin/env node
// One-shot backfill: clients missing ghl_contact_id → GHL lookup/create → store id.
//
// Requires DATABASE_URL. Requires GHL_API_KEY (or GHL_RELAY_API_KEY).
//
//   node scripts/backfill-ghl-contact-ids.mjs            # dry-run (default)
//   node scripts/backfill-ghl-contact-ids.mjs --write    # apply UPDATEs

import { db, close } from "../src/db.mjs";
import { findOrCreateGhlContact, config } from "../src/messaging/ghl-contacts.mjs";

const WRITE = process.argv.includes("--write");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const cfg = config(process.env);
  if (!cfg.ok) {
    console.error("GHL API key unset:", cfg.missing.join(", "));
    console.error("Set GHL_API_KEY (preferred) or GHL_RELAY_API_KEY, then re-run.");
    process.exit(1);
  }

  const { rows } = await db.query(
    `SELECT id, org_id, email, phone, first_name, last_name, ghl_contact_id
       FROM clients
      WHERE ghl_contact_id IS NULL
        AND email IS NOT NULL
        AND email <> ''
      ORDER BY created_at ASC
      LIMIT 5000`
  );

  let scanned = 0, would = 0, updated = 0, errors = 0, skipped = 0;
  for (const c of rows) {
    scanned += 1;
    try {
      const r = await findOrCreateGhlContact({
        email: c.email,
        phone: c.phone,
        firstName: c.first_name,
        lastName: c.last_name
      });
      if (!r.ok) {
        console.warn(`skip ${c.id}: ${r.reason}`);
        skipped += 1;
        continue;
      }
      would += 1;
      if (WRITE) {
        await db.query(
          `UPDATE clients SET ghl_contact_id = $2, updated_at = now() WHERE id = $1`,
          [c.id, r.contactId]
        );
        updated += 1;
      } else {
        console.log(`would update ${c.id} → ${r.contactId}`);
      }
    } catch (err) {
      errors += 1;
      console.error(`error ${c.id}:`, err?.message || err);
    }
  }

  console.log(JSON.stringify({
    mode: WRITE ? "write" : "dry-run",
    scanned, would_update: would, updated, skipped, errors
  }, null, 2));
}

main()
  .then(() => close())
  .catch(async (err) => {
    console.error(err);
    await close().catch(() => {});
    process.exit(1);
  });

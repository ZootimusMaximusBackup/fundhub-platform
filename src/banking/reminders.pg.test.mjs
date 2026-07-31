// Real-Postgres integration test for the cash-flow reminder store.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// WHAT THIS PROVES THAT A STUB CANNOT. Every load-bearing claim this unit makes
// is a claim about POSTGRES, not about JavaScript:
//
//   * that re-running the projection cannot duplicate a reminder — enforced by
//     uq_cashflow_reminders_dedupe, not by the guard in createReminder();
//   * that the reminder-kind and subject-kind vocabularies in reminders.mjs are
//     the same ones the CHECK constraints accept;
//   * that a half-written acknowledgement is refused;
//   * that deleting a client takes its reminders with it.
//
// AUDIT-FINDINGS.md's first lesson is exactly why this file exists: "A fake that
// models the schema you wish you had cannot fail when the schema moves." The
// dedupe case is therefore attacked TWICE — once through createReminder(), and
// once with a raw INSERT that bypasses every line of application code, because
// only the second one is a statement about the database.
//
// It also asserts the NEGATIVE that the whole unit rests on: that
// cashflow_reminders has no delivery columns. If somebody later adds `sent_at`
// or a `status` a worker could poll, this test fails and the reason the table
// was built this way does not quietly disappear.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  createReminder,
  dueReminders,
  forClient,
  acknowledge,
  getReminder,
  ReminderError,
  SUBJECT_KINDS,
  REMINDER_KINDS
} from "./reminders.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

const EMAIL_A = "cashflow_reminders_pg_a@example.com";
const EMAIL_B = "cashflow_reminders_pg_b@example.com";
const EMAILS = [EMAIL_A, EMAIL_B];

const CARD_ID = "11111111-1111-4111-8111-111111111111";
const BILL_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";

const T0 = "2026-08-01T09:00:00.000Z";
const T1 = "2026-08-05T09:00:00.000Z";
const T2 = "2026-08-09T09:00:00.000Z";

let orgId = null;
let otherOrgId = null;
let clientA = null;
let clientB = null;

const base = () => ({
  orgId,
  clientId: clientA,
  subjectKind: "card_liability",
  subjectId: CARD_ID,
  subjectLabel: "Amex Blue Business",
  reminderKind: "payment_due",
  body: "Your Amex payment of $35.00 is due on 12 August.",
  surfaceAt: T1
});

async function wipe() {
  await db.query(`DELETE FROM cashflow_reminders WHERE client_id IN
                    (SELECT id FROM clients WHERE email = ANY($1))`, [EMAILS]);
  await db.query(`DELETE FROM clients WHERE email = ANY($1)`, [EMAILS]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the migrations");

  // A SECOND org, created here rather than looked up: the tenancy assertions
  // below are worthless if the "other org" is the same org, and on a fresh
  // database `SELECT ... OFFSET 1` returns nothing and every one of them would
  // skip itself into green.
  otherOrgId = (
    await db.query(
      `INSERT INTO orgs (slug, name) VALUES ('w8-reminders-other', 'W8 Other Org')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    )
  ).rows[0].id;
  assert.notEqual(otherOrgId, orgId);

  // Fixture clients CREATED, not looked up, for the same reason.
  clientA = (
    await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1, 'Cashflow', 'FixtureA', $2) RETURNING id`,
      [orgId, EMAIL_A]
    )
  ).rows[0].id;
  clientB = (
    await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1, 'Cashflow', 'FixtureB', $2) RETURNING id`,
      [orgId, EMAIL_B]
    )
  ).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await db.query(`DELETE FROM orgs WHERE slug = 'w8-reminders-other'`);
  await close();
});

// ═══════════════════════════════════════════════════════════════════════════
// The table is storage only. Nothing transmits.
// ═══════════════════════════════════════════════════════════════════════════

test("cashflow_reminders has NO delivery columns — nothing here can send", { skip: !HAS_DB }, async () => {
  const { rows } = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cashflow_reminders'`
  );
  const cols = rows.map((r) => r.column_name);
  // If a delivery path is ever wanted it needs a product decision, not a
  // column added quietly to a storage table. This assertion is the tripwire.
  for (const forbidden of [
    "sent_at",
    "delivered_at",
    "status",
    "channel",
    "provider_ref",
    "provider",
    "attempts",
    "retry_count",
    "enabled",
    "active",
    "is_live",
    "scheduled_job_id"
  ]) {
    assert.ok(
      !cols.includes(forbidden),
      `cashflow_reminders must not have a "${forbidden}" column — this table stores, it does not send`
    );
  }
  assert.ok(cols.includes("acknowledged_at"), "acknowledgement is the only lifecycle fact kept");
});

test("no trigger on cashflow_reminders does anything but stamp updated_at", { skip: !HAS_DB }, async () => {
  const { rows } = await db.query(
    `SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.cashflow_reminders'::regclass AND NOT tgisinternal`
  );
  assert.deepEqual(rows.map((r) => r.tgname), ["trg_cashflow_reminders_updated_at"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// The vocabularies in code and in the schema are the same vocabularies.
// ═══════════════════════════════════════════════════════════════════════════

test("every REMINDER_KINDS value is accepted by the CHECK constraint", { skip: !HAS_DB }, async () => {
  for (const kind of REMINDER_KINDS) {
    const { reminder, created } = await createReminder(db, {
      ...base(),
      reminderKind: kind,
      surfaceAt: T1
    });
    assert.equal(created, true, `${kind} should have inserted`);
    assert.equal(reminder.reminder_kind, kind);
  }
  await db.query(`DELETE FROM cashflow_reminders WHERE client_id = $1`, [clientA]);
});

test("every SUBJECT_KINDS value is accepted by the CHECK constraint", { skip: !HAS_DB }, async () => {
  for (const kind of SUBJECT_KINDS) {
    const { created } = await createReminder(db, {
      ...base(),
      subjectKind: kind,
      subjectId: kind === "card_liability" ? CARD_ID : BILL_ID
    });
    assert.equal(created, true);
  }
  await db.query(`DELETE FROM cashflow_reminders WHERE client_id = $1`, [clientA]);
});

test("a kind the module does not know is refused BY THE DATABASE too", { skip: !HAS_DB }, async () => {
  // The module refuses it...
  await assert.rejects(
    () => createReminder(db, { ...base(), reminderKind: "nag" }),
    ReminderError
  );
  // ...and so does the constraint, which is what actually protects the table
  // from a writer that does not go through this module.
  await assert.rejects(
    () =>
      db.query(
        `INSERT INTO cashflow_reminders
           (org_id, client_id, subject_kind, subject_id, subject_label, reminder_kind, body, surface_at)
         VALUES ($1,$2,'card_liability',$3,'X','nag','x',$4)`,
        [orgId, clientA, CARD_ID, T1]
      ),
    (e) => e.code === "23514"
  );
});

test("an empty body or label is refused by the database, not just by the module", { skip: !HAS_DB }, async () => {
  for (const [label, body] of [["   ", "real"], ["real", "   "]]) {
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO cashflow_reminders
             (org_id, client_id, subject_kind, subject_id, subject_label, reminder_kind, body, surface_at)
           VALUES ($1,$2,'card_liability',$3,$4,'payment_due',$5,$6)`,
          [orgId, clientA, CARD_ID, label, body, T1]
        ),
      (e) => e.code === "23514"
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Re-running the projection must not duplicate a reminder.
// ═══════════════════════════════════════════════════════════════════════════

test("writing the identical reminder twice yields ONE row, and says it did not create", { skip: !HAS_DB }, async () => {
  const first = await createReminder(db, base());
  assert.equal(first.created, true);

  const second = await createReminder(db, base());
  assert.equal(second.created, false, "the second write must report that it created nothing");
  assert.equal(second.reminder.id, first.reminder.id, "and must hand back the original row");

  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM cashflow_reminders WHERE client_id = $1`,
    [clientA]
  );
  assert.equal(rows[0].n, 1);
  await db.query(`DELETE FROM cashflow_reminders WHERE client_id = $1`, [clientA]);
});

test("the dedupe is enforced by POSTGRES — a raw insert bypassing the module also fails", { skip: !HAS_DB }, async () => {
  // This is the assertion that matters. createReminder()'s ON CONFLICT could be
  // deleted tomorrow and this would still hold, because the index is the rule.
  await createReminder(db, base());
  await assert.rejects(
    () =>
      db.query(
        `INSERT INTO cashflow_reminders
           (org_id, client_id, subject_kind, subject_id, subject_label, reminder_kind, body, surface_at)
         VALUES ($1,$2,'card_liability',$3,'Amex Blue Business','payment_due','different wording entirely',$4)`,
        [orgId, clientA, CARD_ID, T1]
      ),
    (e) => e.code === "23505",
    "a second row for the same subject/kind/instant must be refused by the unique index"
  );
  await db.query(`DELETE FROM cashflow_reminders WHERE client_id = $1`, [clientA]);
});

test("rewording the body does NOT create a second reminder", { skip: !HAS_DB }, async () => {
  // body is deliberately outside the dedupe key: a copy tweak between two runs
  // is the same reminder said differently, not a new one. If body were in the
  // key, editing a template would silently double every outstanding reminder.
  const first = await createReminder(db, base());
  const second = await createReminder(db, { ...base(), body: "Completely different wording." });
  assert.equal(second.created, false);
  assert.equal(second.reminder.id, first.reminder.id);
  assert.equal(second.reminder.body, first.reminder.body, "the original wording is what was said");
  await db.query(`DELETE FROM cashflow_reminders WHERE client_id = $1`, [clientA]);
});

test("a different instant, subject, kind or client IS a different reminder", { skip: !HAS_DB }, async () => {
  await createReminder(db, base());
  const variants = [
    { ...base(), surfaceAt: T2 },
    { ...base(), subjectKind: "recurring_bill", subjectId: BILL_ID },
    { ...base(), reminderKind: "projected_shortfall" },
    { ...base(), clientId: clientB }
  ];
  for (const v of variants) {
    const { created } = await createReminder(db, v);
    assert.equal(created, true, `${JSON.stringify(v.surfaceAt)} variant should be its own row`);
  }
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM cashflow_reminders WHERE org_id = $1`, [orgId]);
  assert.equal(rows[0].n, 5);
  await db.query(`DELETE FROM cashflow_reminders WHERE org_id = $1`, [orgId]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Reading what is due.
// ═══════════════════════════════════════════════════════════════════════════

test("dueReminders returns what has come due and nothing that has not", { skip: !HAS_DB }, async () => {
  await createReminder(db, { ...base(), surfaceAt: T0, reminderKind: "statement_closed" });
  await createReminder(db, { ...base(), surfaceAt: T1, reminderKind: "payment_due" });
  await createReminder(db, { ...base(), surfaceAt: T2, reminderKind: "payment_window_closing" });

  const due = await dueReminders(db, { orgId, asOf: T1 });
  assert.deepEqual(
    due.map((r) => r.reminder_kind),
    ["statement_closed", "payment_due"],
    "oldest first, and the future one must not appear"
  );
  await db.query(`DELETE FROM cashflow_reminders WHERE org_id = $1`, [orgId]);
});

test("a reminder due at exactly asOf IS due — the boundary, both sides", { skip: !HAS_DB }, async () => {
  await createReminder(db, { ...base(), surfaceAt: T1 });

  const exactly = await dueReminders(db, { orgId, asOf: T1 });
  assert.equal(exactly.length, 1, "surface_at == asOf must be included");

  const oneMsEarlier = await dueReminders(db, { orgId, asOf: "2026-08-05T08:59:59.999Z" });
  assert.equal(oneMsEarlier.length, 0, "one millisecond before, it is not due yet");
  await db.query(`DELETE FROM cashflow_reminders WHERE org_id = $1`, [orgId]);
});

test("reading a reminder does not mark it as anything", { skip: !HAS_DB }, async () => {
  const { reminder } = await createReminder(db, { ...base(), surfaceAt: T0 });
  await dueReminders(db, { orgId, asOf: T2 });
  await dueReminders(db, { orgId, asOf: T2 });
  const after = await getReminder(db, { orgId, reminderId: reminder.id });
  assert.equal(after.acknowledged_at, null);
  assert.deepEqual(after.updated_at, reminder.updated_at, "a SELECT must not touch the row");
  await db.query(`DELETE FROM cashflow_reminders WHERE org_id = $1`, [orgId]);
});

test("dueReminders can be narrowed to one client", { skip: !HAS_DB }, async () => {
  await createReminder(db, { ...base(), surfaceAt: T0 });
  await createReminder(db, { ...base(), clientId: clientB, surfaceAt: T0 });
  const all = await dueReminders(db, { orgId, asOf: T2 });
  assert.equal(all.length, 2);
  const justA = await dueReminders(db, { orgId, asOf: T2, clientId: clientA });
  assert.equal(justA.length, 1);
  assert.equal(justA[0].client_id, clientA);
  await db.query(`DELETE FROM cashflow_reminders WHERE org_id = $1`, [orgId]);
});

test("forClient returns acknowledged reminders too, newest first", { skip: !HAS_DB }, async () => {
  const { reminder } = await createReminder(db, { ...base(), surfaceAt: T0 });
  await createReminder(db, { ...base(), surfaceAt: T2 });
  await acknowledge(db, {
    orgId,
    reminderId: reminder.id,
    at: T1,
    byKind: "staff",
    byId: ACTOR_ID
  });
  const rows = await forClient(db, { orgId, clientId: clientA });
  assert.equal(rows.length, 2, "history keeps the acknowledged one");
  assert.deepEqual(rows.map((r) => r.surface_at.toISOString()), [T2, T0]);
  await db.query(`DELETE FROM cashflow_reminders WHERE org_id = $1`, [orgId]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Acknowledgement.
// ═══════════════════════════════════════════════════════════════════════════

test("acknowledging removes it from the due list and records who and when", { skip: !HAS_DB }, async () => {
  const { reminder } = await createReminder(db, { ...base(), surfaceAt: T0 });
  assert.equal((await dueReminders(db, { orgId, asOf: T2 })).length, 1);

  const ack = await acknowledge(db, {
    orgId,
    reminderId: reminder.id,
    at: T1,
    byKind: "staff",
    byId: ACTOR_ID
  });
  assert.equal(ack.ok, true);
  assert.equal(ack.reminder.acknowledged_by_kind, "staff");
  assert.equal(ack.reminder.acknowledged_by_id, ACTOR_ID);
  assert.equal(ack.reminder.acknowledged_at.toISOString(), T1);

  assert.equal((await dueReminders(db, { orgId, asOf: T2 })).length, 0);
  await db.query(`DELETE FROM cashflow_reminders WHERE org_id = $1`, [orgId]);
});

test("the FIRST acknowledgement wins — a second call does not overwrite it", { skip: !HAS_DB }, async () => {
  const { reminder } = await createReminder(db, { ...base(), surfaceAt: T0 });
  await acknowledge(db, { orgId, reminderId: reminder.id, at: T1, byKind: "staff", byId: ACTOR_ID });

  const second = await acknowledge(db, {
    orgId,
    reminderId: reminder.id,
    at: T2,
    byKind: "account",
    byId: CARD_ID
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "already_acknowledged");
  assert.equal(second.reminder.acknowledged_by_kind, "staff", "the first acknowledger stands");
  assert.equal(second.reminder.acknowledged_at.toISOString(), T1);
  await db.query(`DELETE FROM cashflow_reminders WHERE org_id = $1`, [orgId]);
});

test("a half-written acknowledgement is refused by the database", { skip: !HAS_DB }, async () => {
  // "Acknowledged by somebody, time unrecorded" must not be storable, or a
  // reader cannot tell an unacknowledged reminder from a badly-written one.
  const { reminder } = await createReminder(db, { ...base(), surfaceAt: T0 });
  await assert.rejects(
    () =>
      db.query(`UPDATE cashflow_reminders SET acknowledged_by_kind = 'staff' WHERE id = $1`, [
        reminder.id
      ]),
    (e) => e.code === "23514"
  );
  await assert.rejects(
    () =>
      db.query(`UPDATE cashflow_reminders SET acknowledged_at = $1 WHERE id = $2`, [T1, reminder.id]),
    (e) => e.code === "23514"
  );
  await db.query(`DELETE FROM cashflow_reminders WHERE org_id = $1`, [orgId]);
});

test("acknowledging something that is not in this org is a 404, not a silent no-op", { skip: !HAS_DB }, async () => {
  const { reminder } = await createReminder(db, { ...base(), surfaceAt: T0 });
  await assert.rejects(
    () =>
      acknowledge(db, {
        orgId: otherOrgId,
        reminderId: reminder.id,
        at: T1,
        byKind: "staff",
        byId: ACTOR_ID
      }),
    (e) => e instanceof ReminderError && e.status === 404
  );
  await db.query(`DELETE FROM cashflow_reminders WHERE org_id = $1`, [orgId]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Tenancy and referential integrity.
// ═══════════════════════════════════════════════════════════════════════════

test("every read is scoped to the org — another org sees nothing", { skip: !HAS_DB }, async () => {
  const { reminder } = await createReminder(db, { ...base(), surfaceAt: T0 });
  assert.equal(await getReminder(db, { orgId: otherOrgId, reminderId: reminder.id }), null);
  assert.deepEqual(await dueReminders(db, { orgId: otherOrgId, asOf: T2 }), []);
  assert.deepEqual(await forClient(db, { orgId: otherOrgId, clientId: clientA }), []);
  assert.ok(await getReminder(db, { orgId, reminderId: reminder.id }), "and the owning org does see it");
  await db.query(`DELETE FROM cashflow_reminders WHERE org_id = $1`, [orgId]);
});

test("deleting a client takes its reminders with it", { skip: !HAS_DB }, async () => {
  const doomed = (
    await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Doomed','Client','cashflow_reminders_pg_doomed@example.com') RETURNING id`,
      [orgId]
    )
  ).rows[0].id;
  await createReminder(db, { ...base(), clientId: doomed, surfaceAt: T0 });
  await db.query(`DELETE FROM clients WHERE id = $1`, [doomed]);
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM cashflow_reminders WHERE client_id = $1`,
    [doomed]
  );
  assert.equal(rows[0].n, 0, "ON DELETE CASCADE must have removed them");
});

test("a reminder for a client that does not exist is refused", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => createReminder(db, { ...base(), clientId: "44444444-4444-4444-8444-444444444444" }),
    (e) => e.code === "23503"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Argument validation — nothing reaches the database malformed.
// ═══════════════════════════════════════════════════════════════════════════

test("missing ids, empty text and bad timestamps are refused before any SQL runs", { skip: !HAS_DB }, async () => {
  const bad = [
    { ...base(), orgId: null },
    { ...base(), clientId: "" },
    { ...base(), subjectId: undefined },
    { ...base(), subjectLabel: "   " },
    { ...base(), body: "" },
    { ...base(), surfaceAt: undefined },
    { ...base(), surfaceAt: 1785000000000 },
    { ...base(), surfaceAt: "not a timestamp" },
    { ...base(), surfaceAt: new Date("nope") },
    { ...base(), subjectKind: "invoice" }
  ];
  for (const args of bad) {
    await assert.rejects(() => createReminder(db, args), ReminderError, JSON.stringify(args.surfaceAt ?? ""));
  }
});

test("a bare epoch number is refused as a timestamp — seconds and milliseconds look alike", { skip: !HAS_DB }, async () => {
  await assert.rejects(() => dueReminders(db, { orgId, asOf: 1785000000 }), ReminderError);
  await assert.rejects(() => dueReminders(db, { orgId, asOf: 1785000000000 }), ReminderError);
});

test("a nonsense limit is refused rather than passed to SQL", { skip: !HAS_DB }, async () => {
  for (const limit of [0, -1, 1.5, "10", NaN]) {
    await assert.rejects(() => dueReminders(db, { orgId, asOf: T1, limit }), ReminderError);
    await assert.rejects(() => forClient(db, { orgId, clientId: clientA, limit }), ReminderError);
  }
});

test("dueReminders honours its limit", { skip: !HAS_DB }, async () => {
  for (const kind of REMINDER_KINDS) {
    await createReminder(db, { ...base(), reminderKind: kind, surfaceAt: T0 });
  }
  assert.equal((await dueReminders(db, { orgId, asOf: T2 })).length, REMINDER_KINDS.length);
  assert.equal((await dueReminders(db, { orgId, asOf: T2, limit: 2 })).length, 2);
  await db.query(`DELETE FROM cashflow_reminders WHERE org_id = $1`, [orgId]);
});

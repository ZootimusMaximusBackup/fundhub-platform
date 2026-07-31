// Real-Postgres integration test for mail intake.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// What this proves that the unit tests cannot:
//   - mail_universe.record_slug really does carry a UNIQUE constraint, so the
//     idempotency claim is the database's and not this module's opinion;
//   - that constraint is GLOBAL, not per-org, and the org guard in the upsert
//     is therefore load-bearing rather than decorative;
//   - `fields` jsonb round-trips a real record without mangling it;
//   - suppressed / responded_at / outcome_tier survive a re-ingest untouched,
//     which is the whole reason the ON CONFLICT clause is written the long way;
//   - one row Postgres refuses does not take the batch down with it.
//
// A fake would pass all of this against a schema of its own imagining. That is
// the mistake AUDIT-FINDINGS spends four paragraphs on.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { parseDelimited, ingestBatch } from "./ingest.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

// Every row this file writes is identifiable by one of these two sentinels, so
// the wipe cannot reach a real record.
const SLUG_PREFIX = "mail_ingest_pg_test_";
const CAMPAIGN = "MAIL_INGEST_PG_TEST";
const OTHER_ORG_SLUG = "mail_ingest_pg_test_org";

let orgId = null;
let otherOrgId = null;

const slug = (name) => `${SLUG_PREFIX}${name}`;

async function wipe() {
  await db.query(`DELETE FROM mail_universe WHERE record_slug LIKE $1 || '%'`, [SLUG_PREFIX]);
  await db.query(`DELETE FROM mail_universe WHERE campaign_id LIKE $1 || '%'`, [CAMPAIGN]);
  await db.query(`DELETE FROM orgs WHERE slug = $1`, [OTHER_ORG_SLUG]);
}

const countAll = async () =>
  Number((await db.query(`SELECT count(*)::int AS n FROM mail_universe WHERE record_slug LIKE $1 || '%'`, [SLUG_PREFIX])).rows[0].n);

const readRow = async (recordSlug) =>
  (await db.query(`SELECT * FROM mail_universe WHERE record_slug = $1`, [recordSlug])).rows[0];

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  otherOrgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Mail Ingest PG Test Org') RETURNING id`,
    [OTHER_ORG_SLUG]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

/* =========================================================================
 * The happy path, from file text through to stored rows
 * ========================================================================= */

test("a parsed file becomes one mail_universe row per record, with the whole record in fields", { skip: !HAS_DB }, async () => {
  const file =
    "﻿record_slug,name,address,city,state,zip,phone\r\n" +
    `${slug("a1")},  Ada  Lovelace ,"12 King St, Apt 4",Leeds,ny,11201-4444,(212) 555-0100\r\n` +
    `${slug("a2")},Grace Hopper,,Arlington,,,\r\n`;

  const res = await ingestBatch(db, { orgId, campaignId: CAMPAIGN, rows: parseDelimited(file) });
  assert.equal(res.inserted, 2);
  assert.equal(res.updated, 0);
  assert.equal(res.skipped, 0);
  assert.deepStrictEqual(res.errors, []);

  const row = await readRow(slug("a1"));
  assert.equal(row.org_id, orgId);
  assert.equal(row.campaign_id, CAMPAIGN);
  assert.deepStrictEqual(row.fields, {
    record_slug: slug("a1"),
    name: "Ada Lovelace",
    address: "12 King St, Apt 4",
    city: "Leeds",
    state: "NY",
    zip: "112014444",
    phone: "2125550100"
  }, "normalization happens on the way in, and the per-record data lives in fields");
});

test("a record's blank columns are absent from fields — nothing is filled in on the way to the database", { skip: !HAS_DB }, async () => {
  const row = await readRow(slug("a2"));
  assert.deepStrictEqual(row.fields, {
    record_slug: slug("a2"),
    name: "Grace Hopper",
    city: "Arlington"
  }, "no placeholder name, no default state, no synthesized address");
  assert.equal(Object.prototype.hasOwnProperty.call(row.fields, "state"), false);
});

test("the warnings for a record's blank columns come back with that record's index", { skip: !HAS_DB }, async () => {
  const res = await ingestBatch(db, {
    orgId,
    campaignId: CAMPAIGN,
    rows: [{ record_slug: slug("warn1"), name: "Ada" }, { record_slug: slug("warn2"), name: "", state: "  " }]
  });
  assert.equal(res.inserted, 2);
  assert.deepStrictEqual(res.warnings, [
    { index: 1, warnings: [{ field: "name", code: "missing" }, { field: "state", code: "missing" }] }
  ]);
});

test("fields jsonb round-trips punctuation, quotes and non-ASCII exactly as the file sent them", { skip: !HAS_DB }, async () => {
  const record = {
    record_slug: slug("round1"),
    name: 'Renée O’"Brien"',
    address: "12 King St, Apt 4 — rear",
    note: "50% off; see §10 & <tag>",
    city: "東京"
  };
  await ingestBatch(db, { orgId, campaignId: CAMPAIGN, rows: [record] });
  const row = await readRow(slug("round1"));
  assert.deepStrictEqual(row.fields, record);
});

test("a freshly ingested record arrives un-suppressed with no suppression reason — the suppression pass runs later", { skip: !HAS_DB }, async () => {
  const row = await readRow(slug("a1"));
  assert.equal(row.suppressed, false);
  assert.equal(row.suppression_reason, null);
});

test("ingest leaves responded_at and outcome_tier NULL — the response path owns those", { skip: !HAS_DB }, async () => {
  const row = await readRow(slug("a1"));
  assert.equal(row.responded_at, null);
  assert.equal(row.outcome_tier, null);
});

/* =========================================================================
 * Idempotency on record_slug
 * ========================================================================= */

test("re-ingesting the same file inserts nothing and leaves the row count unchanged", { skip: !HAS_DB }, async () => {
  const rows = [
    { record_slug: slug("idem1"), name: "Ada", city: "Leeds" },
    { record_slug: slug("idem2"), name: "Grace", city: "Arlington" }
  ];
  const first = await ingestBatch(db, { orgId, campaignId: CAMPAIGN, rows });
  const countAfterFirst = await countAll();
  assert.equal(first.inserted, 2);

  const second = await ingestBatch(db, { orgId, campaignId: CAMPAIGN, rows });
  assert.equal(second.inserted, 0, "the second run must not mint a second copy of the same household");
  assert.equal(second.updated, 2);
  assert.equal(second.skipped, 0);
  assert.equal(await countAll(), countAfterFirst);
});

test("the database itself refuses a second row for one record_slug", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => db.query(
      `INSERT INTO mail_universe (org_id, record_slug) VALUES ($1, $2)`,
      [orgId, slug("idem1")]
    ),
    /duplicate key value/,
    "record_slug's UNIQUE constraint from 001_init.sql is what makes ingest idempotent"
  );
});

test("re-ingesting a file does not un-suppress a record that a later pass suppressed", { skip: !HAS_DB }, async () => {
  await db.query(
    `UPDATE mail_universe SET suppressed = true, suppression_reason = 'pg_test_marker' WHERE record_slug = $1`,
    [slug("idem1")]
  );
  await ingestBatch(db, { orgId, campaignId: CAMPAIGN, rows: [{ record_slug: slug("idem1"), name: "Ada", city: "Leeds" }] });

  const row = await readRow(slug("idem1"));
  assert.equal(row.suppressed, true, "the ON CONFLICT branch must never name suppressed");
  assert.equal(row.suppression_reason, "pg_test_marker");
});

test("re-ingesting a file does not forget that a record already responded", { skip: !HAS_DB }, async () => {
  await db.query(
    `UPDATE mail_universe SET responded_at = '2026-07-01T10:00:00Z', outcome_tier = 'pg_test_tier' WHERE record_slug = $1`,
    [slug("idem2")]
  );
  await ingestBatch(db, { orgId, campaignId: CAMPAIGN, rows: [{ record_slug: slug("idem2"), name: "Grace" }] });

  const row = await readRow(slug("idem2"));
  assert.equal(new Date(row.responded_at).toISOString(), "2026-07-01T10:00:00.000Z");
  assert.equal(row.outcome_tier, "pg_test_tier");
});

test("a corrected re-drop merges its columns into fields instead of emptying the ones it left out", { skip: !HAS_DB }, async () => {
  await ingestBatch(db, {
    orgId, campaignId: CAMPAIGN,
    rows: [{ record_slug: slug("merge1"), name: "Ada", city: "Leeds", zip: "11201" }]
  });
  await ingestBatch(db, {
    orgId, campaignId: CAMPAIGN,
    rows: [{ record_slug: slug("merge1"), city: "Bradford", phone: "(212) 555-0100" }]
  });

  const row = await readRow(slug("merge1"));
  assert.deepStrictEqual(row.fields, {
    record_slug: slug("merge1"),
    name: "Ada",                 // absent from the correction, so left standing
    city: "Bradford",            // the correction wins
    zip: "11201",
    phone: "2125550100"          // and new columns land
  });
});

test("a re-ingest that carries no campaign does not blank the campaign already recorded", { skip: !HAS_DB }, async () => {
  await ingestBatch(db, { orgId, campaignId: CAMPAIGN, rows: [{ record_slug: slug("camp1"), name: "Ada" }] });
  await ingestBatch(db, { orgId, rows: [{ record_slug: slug("camp1"), name: "Ada B" }] });

  const row = await readRow(slug("camp1"));
  assert.equal(row.campaign_id, CAMPAIGN, "absence is not a correction");
});

test("a record ingested with no campaign stores NULL rather than an empty string", { skip: !HAS_DB }, async () => {
  await ingestBatch(db, { orgId, campaignId: "   ", rows: [{ record_slug: slug("camp2"), name: "Ada" }] });
  const row = await readRow(slug("camp2"));
  assert.equal(row.campaign_id, null, "an unknown campaign is NULL, not a campaign named nothing");
});

/* =========================================================================
 * Partial failure — one bad row must not abort the batch
 * ========================================================================= */

test("a row with no record_slug is refused while every other row in the batch still lands", { skip: !HAS_DB }, async () => {
  const res = await ingestBatch(db, {
    orgId, campaignId: CAMPAIGN,
    rows: [
      { record_slug: slug("bad1"), name: "Ada" },
      { name: "Nameless", city: "Leeds" },                 // no slug at all
      { record_slug: "   ", name: "Blank" },               // slug present but empty
      { record_slug: slug("bad2"), name: "Grace" }
    ]
  });

  assert.equal(res.inserted, 2);
  assert.equal(res.skipped, 2);
  assert.deepStrictEqual(res.errors, [
    { index: 1, reason: "missing_record_slug" },
    { index: 2, reason: "missing_record_slug" }
  ], "errors carry the row's index in the input array so the operator can find the line");
  assert.ok(await readRow(slug("bad1")));
  assert.ok(await readRow(slug("bad2")));
});

test("a value Postgres cannot store in jsonb fails that row alone and the batch carries on", { skip: !HAS_DB }, async () => {
  const res = await ingestBatch(db, {
    orgId, campaignId: CAMPAIGN,
    rows: [
      { record_slug: slug("nul1"), name: "Ada" },
      { record_slug: slug("nul2"), name: "Gr\u0000ace" },   // a NUL byte is not representable in jsonb
      { record_slug: slug("nul3"), name: "Hopper" }
    ]
  });

  assert.equal(res.inserted, 2);
  assert.equal(res.skipped, 1);
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].index, 1);
  assert.match(res.errors[0].reason, /^db_error_[0-9a-z]{5}$/,
    "the SQLSTATE identifies the fault and cannot leak a character of anyone's data");
  assert.ok(await readRow(slug("nul3")), "the row after the failure was still attempted");
  assert.equal(await readRow(slug("nul2")), undefined);
});

test("the failure reason never carries the database's message, because that message quotes consumer data", { skip: !HAS_DB }, async () => {
  const res = await ingestBatch(db, {
    orgId, campaignId: CAMPAIGN,
    rows: [{ record_slug: slug("leak1"), name: "Ada Lovelace \u0000" }]
  });
  assert.equal(res.errors.length, 1);
  assert.deepStrictEqual(Object.keys(res.errors[0]).sort(), ["index", "reason"]);
  assert.ok(!/Lovelace/i.test(res.errors[0].reason));
});

test("every row given is accounted for: inserted plus updated plus skipped equals the batch size", { skip: !HAS_DB }, async () => {
  const rows = [
    { record_slug: slug("acct1"), name: "A" },
    { name: "no slug" },
    { record_slug: slug("acct1"), name: "A again" },
    { record_slug: slug("acct2"), name: "B" }
  ];
  const res = await ingestBatch(db, { orgId, campaignId: CAMPAIGN, rows });
  assert.equal(res.inserted + res.updated + res.skipped, rows.length);
  assert.equal(res.skipped, res.errors.length);
});

/* =========================================================================
 * Tenancy — record_slug is UNIQUE globally, not per org
 * ========================================================================= */

test("a record_slug already held by another org is refused rather than overwritten", { skip: !HAS_DB }, async () => {
  await ingestBatch(db, { orgId, campaignId: CAMPAIGN, rows: [{ record_slug: slug("tenant1"), name: "Ada" }] });

  const res = await ingestBatch(db, {
    orgId: otherOrgId, campaignId: CAMPAIGN,
    rows: [{ record_slug: slug("tenant1"), name: "Stolen" }]
  });

  assert.equal(res.inserted, 0);
  assert.equal(res.updated, 0);
  assert.deepStrictEqual(res.errors, [{ index: 0, reason: "record_slug_owned_by_another_org" }]);

  const row = await readRow(slug("tenant1"));
  assert.equal(row.org_id, orgId, "one org's mail record must never be rewritten by another's file");
  assert.equal(row.fields.name, "Ada");
});

test("a refused cross-org row does not stop the rest of that org's batch", { skip: !HAS_DB }, async () => {
  const res = await ingestBatch(db, {
    orgId: otherOrgId, campaignId: CAMPAIGN,
    rows: [
      { record_slug: slug("tenant1"), name: "Stolen" },
      { record_slug: slug("tenant2"), name: "Legitimate" }
    ]
  });
  assert.equal(res.inserted, 1);
  assert.equal(res.skipped, 1);
  assert.equal((await readRow(slug("tenant2"))).org_id, otherOrgId);
});

/* =========================================================================
 * Odds and ends
 * ========================================================================= */

test("an empty batch is a no-op that writes nothing", { skip: !HAS_DB }, async () => {
  const before = await countAll();
  const res = await ingestBatch(db, { orgId, campaignId: CAMPAIGN, rows: [] });
  assert.deepStrictEqual(res, { inserted: 0, updated: 0, skipped: 0, errors: [], warnings: [] });
  assert.equal(await countAll(), before);
});

test("a caller that knows the real slug column can name it, and that column is used", { skip: !HAS_DB }, async () => {
  const res = await ingestBatch(db, {
    orgId, campaignId: CAMPAIGN,
    slugField: "Mail Piece ID",
    rows: [{ "Mail Piece ID": slug("named1"), name: "Ada" }]
  });
  assert.equal(res.inserted, 1);
  const row = await readRow(slug("named1"));
  assert.equal(row.fields["Mail Piece ID"], slug("named1"));
});

test("a column named purl is recognised as the slug when no slug column was named", { skip: !HAS_DB }, async () => {
  const res = await ingestBatch(db, { orgId, campaignId: CAMPAIGN, rows: [{ PURL: slug("purl1"), name: "Ada" }] });
  assert.equal(res.inserted, 1);
  assert.ok(await readRow(slug("purl1")));
});

test("ingest writes no rows to any table other than mail_universe", { skip: !HAS_DB }, async () => {
  const before = Number((await db.query(`SELECT count(*)::int AS n FROM events`)).rows[0].n);
  await ingestBatch(db, { orgId, campaignId: CAMPAIGN, rows: [{ record_slug: slug("quiet1"), name: "Ada" }] });
  const after = Number((await db.query(`SELECT count(*)::int AS n FROM events`)).rows[0].n);
  assert.equal(after, before, "intake emits nothing — there is no event for this yet and none was invented");
});

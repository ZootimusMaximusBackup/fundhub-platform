// src/ops/weekly-brief.pg.test.mjs
//
// The whole point of this file: prove the brief never invents a number, and
// that it still ships (as numbers only) when there is no model key and when
// ClickFunnels/YouTube are not connected — which is the real state of things
// the first time this ever runs, before Chris has plugged anything in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { generateWeeklyBrief } from "./weekly-brief.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

async function purgeBrief(orgId, sourceKey) {
  const driveFileId = `generated:weekly-ops-brief:${sourceKey}`;
  const ids = (await db.query(`SELECT id FROM brain_files WHERE org_id = $1 AND drive_file_id = $2`, [orgId, driveFileId])).rows.map((r) => r.id);
  if (ids.length) {
    await db.query(`DELETE FROM brain_chunks WHERE file_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM brain_files WHERE id = ANY($1)`, [ids]);
  }
}

test("with no model key and nothing connected, the brief still ships — numbers only, nothing invented", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, async (t) => {
  const orgId = await resolveDefaultOrg(db);
  const from = new Date("2026-01-05T00:00:00Z");
  const to = new Date("2026-01-12T00:00:00Z");
  const sourceKey = "2026-w02";
  await purgeBrief(orgId, sourceKey);
  t.after(() => purgeBrief(orgId, sourceKey));

  const result = await generateWeeklyBrief(db, {
    orgId, from, to,
    env: {}, // deliberately empty — no ANTHROPIC_API_KEY, no OPENAI_API_KEY
    embed: async (texts) => ({ ok: true, embeddings: texts.map(() => new Array(1536).fill(0.01)) })
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.modelUsed, false, "no key was given, so the model must not have been used");
  assert.match(result.brief, /No model was available/, "the honest fallback line must be present");
  assert.doesNotMatch(result.brief, /\$[1-9]/, "with no ad rows this week, the brief must not contain an invented dollar figure");
  assert.match(result.brief, /Not available: ClickFunnels is not connected yet/);
  assert.match(result.brief, /Not available: YouTube is not connected yet/);
  assert.equal(result.ingestion.ok, true, JSON.stringify(result.ingestion));
});

test("real ad rows produce real numbers in the brief, and re-running the same week updates one document", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, async (t) => {
  const orgId = await resolveDefaultOrg(db);
  const from = new Date("2026-02-02T00:00:00Z");
  const to = new Date("2026-02-09T00:00:00Z");
  const sourceKey = "2026-w06";
  await purgeBrief(orgId, sourceKey);
  const testEmail = "weekly-brief-test-client@example.test";
  t.after(async () => {
    await purgeBrief(orgId, sourceKey);
    await db.query(`DELETE FROM client_ad_attribution WHERE org_id = $1 AND ad_id = '999999'`, [orgId]);
    await db.query(`DELETE FROM clients WHERE org_id = $1 AND email = $2`, [orgId, testEmail]);
  });

  // client_ad_attribution.client_id has a real FK to clients — a throwaway
  // row is needed first. lane/ad_id/variant on the attribution row are
  // GENERATED columns; the real inputs are the utm_* fields, see
  // fundhub_ad_lane() in db/migrations/286_client_ad_attribution.sql.
  await db.query(`DELETE FROM clients WHERE org_id = $1 AND email = $2`, [orgId, testEmail]);
  const clientId = (await db.query(
    `INSERT INTO clients (org_id, email) VALUES ($1, $2) RETURNING id`,
    [orgId, testEmail]
  )).rows[0].id;

  await db.query(
    `INSERT INTO client_ad_attribution (org_id, client_id, utm_campaign, utm_content, utm_term, captured_at)
     VALUES ($1, $2, 'funding600', '999999-test', 'sun', $3)`,
    [orgId, clientId, new Date("2026-02-03T12:00:00Z")]
  );

  const fakeEmbed = async (texts) => ({ ok: true, embeddings: texts.map(() => new Array(1536).fill(0.02)) });

  const first = await generateWeeklyBrief(db, { orgId, from, to, env: {}, embed: fakeEmbed });
  assert.match(first.brief, /1 leads, 0 booked calls/, first.brief);

  const second = await generateWeeklyBrief(db, { orgId, from, to, env: {}, embed: fakeEmbed });
  assert.equal(first.ingestion.fileId, second.ingestion.fileId, "the same week must update one document, not create a second one");
});

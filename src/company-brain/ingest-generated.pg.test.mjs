// src/company-brain/ingest-generated.pg.test.mjs
//
// Proves upsertGeneratedDocument really lands a document in brain_files /
// brain_chunks that retrieveChunks can then find — the whole point of this
// file is to make generated data (a weekly brief, an ad-performance summary)
// askable through Company Brain the same way a real Drive file already is.

import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { upsertGeneratedDocument, driveFileIdFor } from "./ingest-generated.mjs";
import { retrieveChunks } from "./retrieve.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

// A fake, deterministic embedder so this test needs no real OpenAI key and
// no network — it proves the STORAGE path, not the embedding quality. Two
// different texts get two different (but each internally consistent)
// pseudo-vectors, which is all retrieveChunks' cosine search needs to tell
// them apart.
function fakeEmbedFor(text) {
  const v = new Array(1536).fill(0);
  for (let i = 0; i < text.length; i++) v[i % 1536] += text.charCodeAt(i) / 1000;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
async function fakeEmbed(texts) {
  return { ok: true, embeddings: texts.map(fakeEmbedFor) };
}

async function purge(orgId) {
  const ids = (await db.query(
    `SELECT id FROM brain_files WHERE org_id = $1 AND drive_file_id LIKE 'generated:test-%'`,
    [orgId]
  )).rows.map((r) => r.id);
  if (ids.length) {
    await db.query(`DELETE FROM brain_chunks WHERE file_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM brain_files WHERE id = ANY($1)`, [ids]);
  }
}

test("upsertGeneratedDocument lands a document that retrieveChunks can then find", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, async (t) => {
  const orgId = await resolveDefaultOrg(db);
  await purge(orgId);
  t.after(() => purge(orgId));

  const text = "Ad performance week 36: funding600 lane booked 40 calls off 210 leads. sorting lane booked 15 off 90 leads.";
  const result = await upsertGeneratedDocument(db, {
    orgId,
    sourceType: "test-ad-summary",
    sourceKey: "2026-w36",
    title: "Ad performance, week 36",
    text,
    accessTier: "owner",
    embed: fakeEmbed
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.fileId);
  assert.equal(result.chunkCount, 1, "one short paragraph should be one chunk");

  const row = (await db.query(`SELECT drive_file_id, name, access_tier FROM brain_files WHERE id = $1`, [result.fileId])).rows[0];
  assert.equal(row.drive_file_id, driveFileIdFor("test-ad-summary", "2026-w36"));
  assert.equal(row.name, "Ad performance, week 36");
  assert.equal(row.access_tier, "owner");

  const found = await retrieveChunks(db, {
    orgId,
    role: "owner",
    query: text,
    embed: fakeEmbed,
    limit: 5
  });
  assert.equal(found.ok, true, JSON.stringify(found));
  assert.ok(found.chunks.some((c) => c.fileId === result.fileId || c.driveFileId === row.drive_file_id), JSON.stringify(found.chunks));
});

test("re-ingesting the same content is a no-op (skipped, not duplicated)", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, async (t) => {
  const orgId = await resolveDefaultOrg(db);
  await purge(orgId);
  t.after(() => purge(orgId));

  const text = "Same content both times.";
  const first = await upsertGeneratedDocument(db, { orgId, sourceType: "test-idempotent", sourceKey: "k1", text, embed: fakeEmbed });
  const second = await upsertGeneratedDocument(db, { orgId, sourceType: "test-idempotent", sourceKey: "k1", text, embed: fakeEmbed });

  assert.equal(first.skipped, false);
  assert.equal(second.skipped, true);
  assert.equal(first.fileId, second.fileId);

  const count = (await db.query(`SELECT count(*) FROM brain_files WHERE drive_file_id = $1`, [driveFileIdFor("test-idempotent", "k1")])).rows[0].count;
  assert.equal(Number(count), 1);
});

test("changed content re-embeds and replaces the chunks, not appends", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, async (t) => {
  const orgId = await resolveDefaultOrg(db);
  await purge(orgId);
  t.after(() => purge(orgId));

  const first = await upsertGeneratedDocument(db, { orgId, sourceType: "test-changed", sourceKey: "k1", text: "version one", embed: fakeEmbed });
  const second = await upsertGeneratedDocument(db, { orgId, sourceType: "test-changed", sourceKey: "k1", text: "version two, longer text now", embed: fakeEmbed });

  assert.equal(second.skipped, false);
  assert.equal(first.fileId, second.fileId, "same source key must update the same row, not create a second one");

  const rows = (await db.query(`SELECT content FROM brain_chunks WHERE file_id = $1`, [second.fileId])).rows;
  assert.ok(rows.every((r) => r.content.includes("version two")), JSON.stringify(rows));
});

// End-to-end tests for POST/GET /api/staff/avatar — an employee's own
// profile photo. Drives the real Netlify handler against real Postgres
// (DATABASE_URL), same shape as src/http/documents-upload.pg.test.mjs:
// multipart parsing in netlify/functions/api.mjs, the in-memory storage
// provider (DOCUMENT_STORE_PROVIDER left unset — no real storage vendor
// needed here), and the staff.avatar_key column
// (db/migrations/270_staff_avatar_key.sql).
//
// SELF-SCOPED ONLY. Every test drives the endpoint as one staff member
// acting on themselves — there is no staffId parameter anywhere on this
// route, so there is nothing to pass and nothing to isolation-test beyond
// "each caller only ever sees their own row", which the cross-staff test
// below covers.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const EMAIL_TAG = "avatar.fixture";

// Real magic-number bytes — the endpoint sniffs, it does not trust a filename
// or a declared Content-Type.
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  1, 2, 3, 4, 5, 6, 7, 8
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
const NOT_AN_IMAGE = Buffer.from("just plain text, not a jpg/png at all");
const PDF_BYTES = Buffer.from("%PDF-1.4\n%fixture pdf body, rejected here on purpose\n%%EOF");

describe("POST/GET /api/staff/avatar", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, staffAId, staffBId, tokenA, tokenB, handler;

  const call = (path, init = {}) =>
    handler(new Request("https://site.netlify.app" + path, { host: "site.netlify.app", ...init }), {});

  const uploadForm = (bytes, opts = {}) => {
    const form = new FormData();
    const blob = new Blob([bytes], { type: opts.mimeType || "image/png" });
    form.append(opts.field ?? "photo", blob, opts.filename || "photo.png");
    return form;
  };

  const post = (token, form) =>
    call("/api/staff/avatar", {
      method: "POST",
      headers: token ? { authorization: "Bearer " + token } : {},
      body: form
    });

  const get = (token) =>
    call("/api/staff/avatar", {
      method: "GET",
      headers: token ? { authorization: "Bearer " + token } : {}
    });

  before(async () => {
    delete process.env.DOCUMENT_STORE_PROVIDER; // memory provider — no real storage vendor needed
    ({ default: handler } = await import("../../netlify/functions/api.mjs"));

    org = await resolveDefaultOrg(db);
    await purge();

    const staffA = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Avatar Fixture A','closer','active') RETURNING id`,
      [org, `${EMAIL_TAG}.a@example.com`])).rows[0];
    staffAId = staffA.id;
    tokenA = (await createSession(db, { staffId: staffAId, orgId: org })).token;

    const staffB = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Avatar Fixture B','owner','active') RETURNING id`,
      [org, `${EMAIL_TAG}.b@example.com`])).rows[0];
    staffBId = staffB.id;
    tokenB = (await createSession(db, { staffId: staffBId, orgId: org })).token;
  });

  async function purge() {
    await db.query(`DELETE FROM sessions WHERE staff_id IN
                     (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
  }

  after(async () => {
    await purge();
    await close();
  });

  // ── auth ─────────────────────────────────────────────────────────────────

  test("POST with no session at all is refused", async () => {
    const r = await post(null, uploadForm(PNG_BYTES));
    assert.equal(r.status, 401);
  });

  test("GET with no session at all is refused", async () => {
    const r = await get(null);
    assert.equal(r.status, 401);
  });

  test("a non-GET/POST method is refused", async () => {
    const r = await call("/api/staff/avatar", {
      method: "DELETE", headers: { authorization: "Bearer " + tokenA }
    });
    assert.equal(r.status, 405);
  });

  // ── no photo yet ─────────────────────────────────────────────────────────

  test("GET before any upload is a 404, not an empty 200", async () => {
    const r = await get(tokenA);
    assert.equal(r.status, 404);
  });

  // ── the happy path: upload then read back the exact bytes ─────────────────

  test("a staff member can upload their own photo and read the exact bytes back", async () => {
    const up = await post(tokenA, uploadForm(PNG_BYTES, { filename: "me.png" }));
    const upBody = await up.json();
    assert.equal(up.status, 200, JSON.stringify(upBody));
    assert.equal(upBody.ok, true);
    assert.equal(upBody.avatarUrl, "/api/staff/avatar");

    const dl = await get(tokenA);
    assert.equal(dl.status, 200);
    const got = Buffer.from(await dl.arrayBuffer());
    assert.ok(got.equals(PNG_BYTES), "downloaded bytes do not match the uploaded bytes");
    assert.equal(dl.headers.get("content-type"), "image/png");

    const row = (await db.query(`SELECT avatar_key FROM staff WHERE id = $1`, [staffAId])).rows[0];
    assert.ok(row.avatar_key, "avatar_key was not persisted");
  });

  test("a jpeg round-trips as binary-identical bytes too", async () => {
    const up = await post(tokenB, uploadForm(JPEG_BYTES, { mimeType: "image/jpeg", filename: "b.jpg" }));
    assert.equal(up.status, 200);

    const dl = await get(tokenB);
    assert.equal(dl.status, 200);
    assert.ok(Buffer.from(await dl.arrayBuffer()).equals(JPEG_BYTES));
    assert.equal(dl.headers.get("content-type"), "image/jpeg");
  });

  test("re-uploading replaces the stored photo", async () => {
    const NEW_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);
    await post(tokenA, uploadForm(PNG_BYTES, { filename: "first.png" }));
    const second = await post(tokenA, uploadForm(NEW_PNG, { filename: "second.png" }));
    assert.equal(second.status, 200);

    const dl = await get(tokenA);
    const got = Buffer.from(await dl.arrayBuffer());
    assert.ok(got.equals(NEW_PNG), "GET did not return the most recently uploaded photo");
  });

  // ── validation: bytes decide, not the filename or declared header ─────────

  test("rejects a non-image file even with a .png filename", async () => {
    const r = await post(tokenA, uploadForm(NOT_AN_IMAGE, { filename: "totally-a-photo.png" }));
    const body = await r.json();
    assert.equal(r.status, 400);
    assert.equal(body.error, "invalid_file_type");
  });

  test("rejects a pdf — this endpoint is image-only, unlike the client document upload", async () => {
    const r = await post(tokenA, uploadForm(PDF_BYTES, { mimeType: "application/pdf", filename: "doc.pdf" }));
    const body = await r.json();
    assert.equal(r.status, 400);
    assert.equal(body.error, "invalid_file_type");
  });

  test("rejects a file over the 5MB cap", async () => {
    const big = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(5 * 1024 * 1024 + 1)
    ]);
    const r = await post(tokenA, uploadForm(big));
    const body = await r.json();
    assert.equal(r.status, 400);
    assert.equal(body.error, "file_too_large");
  });

  test("no file in the request is a 400", async () => {
    const form = new FormData();
    const r = await post(tokenA, form);
    assert.equal(r.status, 400);
  });

  test("a field named anything other than 'photo' is ignored — a 400, not a silent accept", async () => {
    const r = await post(tokenA, uploadForm(PNG_BYTES, { field: "file" }));
    const body = await r.json();
    assert.equal(r.status, 400);
    assert.equal(body.error, "no_file");
  });

  // ── isolation: self-scoped only, no way to name another staff id ──────────

  test("one staff member cannot fetch another staff member's photo", async () => {
    // A uploads a distinctive photo. C is a fresh staff member who has never
    // uploaded anything and has no staffId-shaped parameter on this route to
    // even attempt naming A. C's own GET must 404 — not A's bytes, not a 200
    // of any kind.
    const distinctive = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 42, 42, 42]);
    const up = await post(tokenA, uploadForm(distinctive, { filename: "isolated.png" }));
    assert.equal(up.status, 200);

    const staffC = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Avatar Fixture C','inquiry_specialist','active') RETURNING id`,
      [org, `${EMAIL_TAG}.c@example.com`])).rows[0];
    const tokenC = (await createSession(db, { staffId: staffC.id, orgId: org })).token;

    const cDownload = await get(tokenC);
    assert.equal(cDownload.status, 404, "a staff member with no photo of their own must not see anyone else's");

    // Sanity: A's own GET still returns A's bytes, proving isolation is real
    // and not just "everyone gets 404".
    const aDownload = await get(tokenA);
    assert.equal(aDownload.status, 200);
    assert.ok(Buffer.from(await aDownload.arrayBuffer()).equals(distinctive));
  });
});

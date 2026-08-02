import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { createDriveClient } from "./drive-client.mjs";
import { syncDriveIncremental, getSyncState, saveSyncState } from "./sync.mjs";
import { deleteByDriveFileId } from "./store.mjs";

const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const SA = { clientEmail: "brain@test.iam.gserviceaccount.com", privateKey };

function mockFetch(routes) {
  return async (url, init = {}) => {
    const u = String(url);
    const hit = routes.find((r) => r.match(u, init));
    if (!hit) throw new Error(`unexpected fetch: ${u}`);
    const body = typeof hit.body === "function" ? hit.body(u, init) : hit.body;
    const status = hit.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        if (Buffer.isBuffer(body)) return body.toString("utf8");
        return typeof body === "string" ? body : JSON.stringify(body);
      },
      async arrayBuffer() {
        if (Buffer.isBuffer(body)) {
          return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
        }
        const s = typeof body === "string" ? body : JSON.stringify(body);
        return Buffer.from(s).buffer;
      }
    };
  };
}

function memoryDb() {
  const sync = new Map();
  const files = new Map();
  return {
    sync,
    files,
    async query(sql, params) {
      if (/FROM brain_drive_sync/i.test(sql) && /SELECT/i.test(sql)) {
        const row = sync.get(params[0]);
        return { rows: row ? [row] : [] };
      }
      if (/INSERT INTO brain_drive_sync/i.test(sql)) {
        sync.set(params[0], {
          org_id: params[0],
          page_token: params[1],
          last_error: params[2],
          last_sync_at: new Date().toISOString()
        });
        return { rows: [] };
      }
      if (/DELETE FROM brain_files/i.test(sql)) {
        const key = `${params[0]}:${params[1]}`;
        const had = files.has(key);
        files.delete(key);
        return { rows: had ? [{ id: "x" }] : [] };
      }
      return { rows: [] };
    }
  };
}

test("getStartPageToken and listAllChanges via mocked Drive", async () => {
  const fetchImpl = mockFetch([
    {
      match: (u) => u.includes("oauth2.googleapis.com/token"),
      body: { access_token: "t", expires_in: 3600 }
    },
    {
      match: (u) => u.includes("/changes/startPageToken"),
      body: { startPageToken: "tok-1" }
    },
    {
      match: (u) => u.includes("/changes?") && u.includes("pageToken=tok-1"),
      body: {
        changes: [
          { fileId: "f1", removed: false, file: { id: "f1", name: "A", mimeType: "text/plain" } },
          { fileId: "f2", removed: true }
        ],
        newStartPageToken: "tok-2"
      }
    }
  ]);
  const client = createDriveClient({
    serviceAccount: SA,
    delegateEmail: "owner@fundhub.test",
    fetchImpl
  });
  assert.equal(await client.getStartPageToken(), "tok-1");
  const { changes, newStartPageToken } = await client.listAllChanges("tok-1");
  assert.equal(newStartPageToken, "tok-2");
  assert.equal(changes.length, 2);
  assert.equal(changes[1].removed, true);
});

test("saveSyncState / getSyncState round-trip", async () => {
  const db = memoryDb();
  await saveSyncState(db, { orgId: "org-1", pageToken: "abc" });
  const row = await getSyncState(db, "org-1");
  assert.equal(row.page_token, "abc");
});

test("deleteByDriveFileId removes indexed file", async () => {
  const db = memoryDb();
  db.files.set("org-1:drive-9", { id: "row-1" });
  const out = await deleteByDriveFileId(db, { orgId: "org-1", driveFileId: "drive-9" });
  assert.equal(out.ok, true);
  assert.equal(out.deleted, 1);
  assert.equal(db.files.has("org-1:drive-9"), false);
});

test("syncDriveIncremental full mode seeds page token", async () => {
  const db = memoryDb();
  const client = {
    async getStartPageToken() { return "seed-1"; },
    async listAllChanges() { throw new Error("should not run"); }
  };
  const walk = async () => ({
    ok: true,
    files: [
      { fileId: "d1", name: "SOP", mimeType: "text/plain", text: "hello", ok: true, reason: null },
      { fileId: "img", name: "x.png", mimeType: "image/png", ok: false, reason: "skipped:image" }
    ],
    summary: { seen: 2, extracted: 1, skipped: 1 }
  });
  const upserts = [];
  const out = await syncDriveIncremental(db, {
    orgId: "org-1",
    client,
    walk,
    upsert: async (_db, args) => {
      upserts.push(args.extracted.fileId);
      return { ok: true };
    },
    env: {
      GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: SA.clientEmail,
        private_key: SA.privateKey
      }),
      GOOGLE_DRIVE_DELEGATE_EMAIL: "owner@fundhub.test"
    }
  });
  assert.equal(out.ok, true);
  assert.equal(out.mode, "full");
  assert.equal(out.pageToken, "seed-1");
  assert.deepEqual(upserts, ["d1"]);
  assert.equal((await getSyncState(db, "org-1")).page_token, "seed-1");
});

test("syncDriveIncremental incremental upserts and deletes", async () => {
  const db = memoryDb();
  await saveSyncState(db, { orgId: "org-1", pageToken: "tok-1" });

  const client = {
    async getStartPageToken() { return "unused"; },
    async listAllChanges(token) {
      assert.equal(token, "tok-1");
      return {
        newStartPageToken: "tok-2",
        changes: [
          {
            fileId: "new1",
            removed: false,
            file: {
              id: "new1",
              name: "New.doc",
              mimeType: "application/vnd.google-apps.document"
            }
          },
          { fileId: "gone", removed: true, file: null }
        ]
      };
    },
    async exportFile() { return Buffer.from("new body"); },
    async downloadMedia() { return Buffer.from(""); }
  };

  const upserts = [];
  const deletes = [];
  const out = await syncDriveIncremental(db, {
    orgId: "org-1",
    client,
    walk: async () => ({ ok: false, reason: "should_not_full_walk" }),
    upsert: async (_db, args) => {
      upserts.push(args.extracted.fileId);
      return { ok: true };
    },
    remove: async (_db, args) => {
      deletes.push(args.driveFileId);
      return { ok: true, deleted: 1 };
    }
  });

  assert.equal(out.ok, true);
  assert.equal(out.mode, "incremental");
  assert.equal(out.pageToken, "tok-2");
  assert.deepEqual(upserts, ["new1"]);
  assert.deepEqual(deletes, ["gone"]);
  assert.equal((await getSyncState(db, "org-1")).page_token, "tok-2");
});

test("expired page token forces full walk", async () => {
  const db = memoryDb();
  await saveSyncState(db, { orgId: "org-1", pageToken: "old" });
  let walked = 0;
  const err = new Error("expired");
  err.code = "PAGE_TOKEN_EXPIRED";
  const client = {
    async listAllChanges() { throw err; },
    async getStartPageToken() { return "fresh"; }
  };
  const out = await syncDriveIncremental(db, {
    orgId: "org-1",
    client,
    walk: async () => {
      walked += 1;
      return { ok: true, files: [], summary: { seen: 0, extracted: 0, skipped: 0 } };
    },
    upsert: async () => ({ ok: true })
  });
  assert.equal(out.ok, true);
  assert.equal(out.mode, "full");
  assert.equal(walked, 1);
  assert.equal((await getSyncState(db, "org-1")).page_token, "fresh");
});

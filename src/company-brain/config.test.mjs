import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { driveConfigFromEnv } from "./config.mjs";
import { buildServiceAccountJwt, fetchAccessToken } from "./auth.mjs";
import { classifyMime, needsMediaDownload } from "./mime.mjs";
import { sniffClientId } from "./client-id.mjs";
import { unzipEntries, extractDocxText, extractOfficeText } from "./office.mjs";
import { extractPdfText } from "./pdf-text.mjs";
import { extractFromDriveFile } from "./extract.mjs";
import { createDriveClient } from "./drive-client.mjs";
import { walkDriveAndExtract } from "./walk.mjs";

// ── fixtures ───────────────────────────────────────────────────────────────

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
void publicKey;

const SA = {
  clientEmail: "brain@test.iam.gserviceaccount.com",
  privateKey
};

function zipStore(entries) {
  const parts = [];
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(0, 8); // store
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt32LE(0, 14); // crc (unchecked by our reader)
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(payload.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    parts.push(header, nameBuf, payload);
  }
  return Buffer.concat(parts);
}

function mockFetch(routes) {
  return async (url, init = {}) => {
    const u = String(url);
    const hit = routes.find((r) => r.match(u, init));
    if (!hit) throw new Error(`unexpected fetch: ${u}`);
    const body = typeof hit.body === "function" ? hit.body(u, init) : hit.body;
    const status = hit.status || 200;
    const headers = hit.headers || { "content-type": "application/json" };
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        if (Buffer.isBuffer(body)) return body.toString("utf8");
        return typeof body === "string" ? body : JSON.stringify(body);
      },
      async arrayBuffer() {
        if (Buffer.isBuffer(body)) return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
        const s = typeof body === "string" ? body : JSON.stringify(body);
        return Buffer.from(s).buffer;
      },
      async json() {
        return typeof body === "string" ? JSON.parse(body) : body;
      }
    };
  };
}

// ── config ─────────────────────────────────────────────────────────────────

test("driveConfigFromEnv reports missing keys", () => {
  const c = driveConfigFromEnv({});
  assert.equal(c.ready, false);
  assert.ok(c.missing.includes("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"));
  assert.equal(c.delegateEmail, null);
  assert.deepEqual(c.excludedFolderIds, []);
});

test("driveConfigFromEnv is ready with JSON only (no Workspace impersonation)", () => {
  const c = driveConfigFromEnv({
    GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: SA.clientEmail,
      private_key: SA.privateKey,
      project_id: "p"
    })
  });
  assert.equal(c.ready, true);
  assert.equal(c.delegateEmail, null);
});

test("driveConfigFromEnv parses service account JSON", () => {
  const c = driveConfigFromEnv({
    GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: SA.clientEmail,
      private_key: SA.privateKey,
      project_id: "p"
    }),
    GOOGLE_DRIVE_DELEGATE_EMAIL: "owner@fundhub.test"
  });
  assert.equal(c.ready, true);
  assert.equal(c.serviceAccount.clientEmail, SA.clientEmail);
  assert.equal(c.delegateEmail, "owner@fundhub.test");
});

// ── auth ───────────────────────────────────────────────────────────────────

test("buildServiceAccountJwt is verifiable RS256", () => {
  const jwt = buildServiceAccountJwt({
    clientEmail: SA.clientEmail,
    privateKey: SA.privateKey,
    delegateEmail: "owner@fundhub.test",
    nowSec: 1_700_000_000
  });
  const [h, p, s] = jwt.split(".");
  assert.ok(h && p && s);
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${h}.${p}`);
  verifier.end();
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (padded.length % 4)) % 4);
  const sig = Buffer.from(padded + pad, "base64");
  assert.equal(verifier.verify(crypto.createPublicKey(SA.privateKey), sig), true);
});

test("buildServiceAccountJwt omits sub when there is no Workspace delegate", () => {
  const jwt = buildServiceAccountJwt({
    clientEmail: SA.clientEmail,
    privateKey: SA.privateKey,
    nowSec: 1_700_000_000
  });
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.iss, SA.clientEmail);
  assert.equal(payload.sub, undefined);
});

test("fetchAccessToken posts JWT grant", async () => {
  const fetchImpl = mockFetch([
    {
      match: (u) => u.includes("oauth2.googleapis.com/token"),
      body: { access_token: "tok-1", expires_in: 3600, token_type: "Bearer" }
    }
  ]);
  const tok = await fetchAccessToken({
    clientEmail: SA.clientEmail,
    privateKey: SA.privateKey,
    delegateEmail: "owner@fundhub.test",
    fetchImpl
  });
  assert.equal(tok.accessToken, "tok-1");
});

// ── mime / client id ───────────────────────────────────────────────────────

test("classifyMime covers google, pdf, office, image skip, av", () => {
  assert.equal(classifyMime("application/vnd.google-apps.document").action, "export");
  assert.equal(classifyMime("application/pdf").kind, "pdf");
  assert.equal(classifyMime("image/png").action, "skip");
  assert.equal(classifyMime("audio/mpeg").kind, "av");
  assert.equal(classifyMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document").kind, "office");
  assert.equal(needsMediaDownload(classifyMime("application/pdf")), true);
  assert.equal(needsMediaDownload(classifyMime("video/mp4")), false);
});

test("sniffClientId finds uuid in name or parent", () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  assert.equal(sniffClientId({ name: `call-${id}.mp3` }).clientId, id);
  assert.equal(sniffClientId({ name: "call.mp3", parentNames: [`client_id=${id}`] }).clientId, id);
  assert.equal(sniffClientId({ name: "orphan.mp3" }).unattached, true);
});

// ── office / pdf ───────────────────────────────────────────────────────────

test("unzip + docx text extract", () => {
  const xml = `<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>Hello Brain</w:t></w:r></w:p></w:body></w:document>`;
  const buf = zipStore([["word/document.xml", xml]]);
  const entries = unzipEntries(buf);
  assert.ok(entries.has("word/document.xml"));
  assert.match(extractDocxText(buf), /Hello Brain/);
  const office = extractOfficeText(
    buf,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  assert.equal(office.ok, true);
  assert.match(office.text, /Hello Brain/);
});

test("extractPdfText reads drawn text", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Company Brain PDF", { x: 40, y: 300, size: 14, font });
  const bytes = Buffer.from(await doc.save());
  const result = await extractPdfText(bytes);
  assert.equal(result.ok, true);
  assert.match(result.text, /Company Brain PDF/);
  assert.equal(result.needsOcr, false);
});

// ── extract orchestration ──────────────────────────────────────────────────

test("extractFromDriveFile exports google doc text", async () => {
  const result = await extractFromDriveFile(
    { id: "g1", name: "SOP", mimeType: "application/vnd.google-apps.document" },
    { exportTo: async () => Buffer.from("Step one\nStep two") }
  );
  assert.equal(result.ok, true);
  assert.match(result.text, /Step one/);
});

test("extractFromDriveFile skips images", async () => {
  const result = await extractFromDriveFile(
    { id: "i1", name: "logo.png", mimeType: "image/png" }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "skipped:image");
});

test("extractFromDriveFile flags av for transcription + client sniff", async () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  const result = await extractFromDriveFile(
    { id: "a1", name: `rec-${id}.mp3`, mimeType: "audio/mpeg" },
    { download: async () => Buffer.from("ID3fake") }
  );
  assert.equal(result.ok, true);
  assert.equal(result.needsTranscription, true);
  assert.equal(result.clientId, id);
  assert.equal(result.byteLength, 7);
});

test("extractFromDriveFile flags av without downloading bytes", async () => {
  const result = await extractFromDriveFile(
    { id: "a2", name: "Meet - Jane Doe.mp4", mimeType: "video/mp4" }
  );
  assert.equal(result.ok, true);
  assert.equal(result.needsTranscription, true);
  assert.equal(result.unattached, true);
  assert.equal(result.byteLength, null);
});

// ── drive client + walk ────────────────────────────────────────────────────

test("createDriveClient lists and exports via mocked fetch", async () => {
  const fetchImpl = mockFetch([
    {
      match: (u) => u.includes("oauth2.googleapis.com/token"),
      body: { access_token: "t", expires_in: 3600 }
    },
    {
      match: (u) => u.includes("/drive/v3/files?") && u.includes("trashed"),
      body: {
        files: [
          {
            id: "doc1",
            name: "Playbook",
            mimeType: "application/vnd.google-apps.document",
            parents: [],
            webViewLink: "https://drive.google.com/file/d/doc1"
          },
          {
            id: "img1",
            name: "shot.png",
            mimeType: "image/png",
            parents: []
          }
        ]
      }
    },
    {
      match: (u) => u.includes("/files/doc1/export"),
      body: Buffer.from("Closer script body"),
      headers: { "content-type": "text/plain" }
    }
  ]);

  const client = createDriveClient({
    serviceAccount: SA,
    delegateEmail: "owner@fundhub.test",
    fetchImpl
  });

  const listed = [];
  for await (const f of client.listAllFiles()) listed.push(f);
  assert.equal(listed.length, 2);

  const exported = await client.exportFile("doc1", "text/plain");
  assert.equal(exported.toString("utf8"), "Closer script body");
});

test("walkDriveAndExtract summarizes mocked Drive", async () => {
  const fetchImpl = mockFetch([
    {
      match: (u) => u.includes("oauth2.googleapis.com/token"),
      body: { access_token: "t", expires_in: 3600 }
    },
    {
      match: (u) => u.includes("/drive/v3/files?") && !u.includes("alt=media") && !u.includes("/export"),
      body: {
        files: [
          { id: "folder1", name: "Recordings", mimeType: "application/vnd.google-apps.folder" },
          {
            id: "doc1",
            name: "SOP",
            mimeType: "application/vnd.google-apps.document",
            parents: ["folder1"],
            webViewLink: "https://drive.google.com/file/d/doc1"
          },
          {
            id: "img1",
            name: "x.png",
            mimeType: "image/png",
            parents: ["folder1"]
          }
        ]
      }
    },
    {
      match: (u) => u.includes("/files/doc1/export"),
      body: Buffer.from("Do the thing"),
      headers: { "content-type": "text/plain" }
    }
  ]);

  const out = await walkDriveAndExtract({
    env: {
      GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: SA.clientEmail,
        private_key: SA.privateKey
      }),
      GOOGLE_DRIVE_DELEGATE_EMAIL: "owner@fundhub.test"
    },
    fetchImpl
  });

  assert.equal(out.ok, true);
  assert.equal(out.summary.seen, 2); // folder excluded from seen count
  assert.equal(out.summary.extracted, 1);
  assert.equal(out.summary.skipped, 1);
  const sop = out.files.find((f) => f.fileId === "doc1");
  assert.match(sop.text, /Do the thing/);
});

test("walkDriveAndExtract fails closed when env missing", async () => {
  const out = await walkDriveAndExtract({ env: {} });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "not_configured");
});

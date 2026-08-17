/* /api/content/upload — welcome video write. */
import { test, describe, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import handler from "../../api/content/upload.mjs";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const STAFF = "44444444-4444-4444-8444-444444444444";
const VID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const realQuery = db.query;

function stubDb({ session = null, answers = [] } = {}) {
  db.query = async (text, params) => {
    if (/FROM live JOIN staff s/i.test(text)) {
      if (!session) return { rows: [] };
      const pick = (key, fallback) => (key in session ? session[key] : fallback);
      return { rows: [{
        session_id: "sess-1", expires_at: new Date(Date.now() + 3_600_000),
        staff_id: pick("staffId", STAFF), org_id: pick("orgId", ORG_A),
        role: pick("role", "owner"), email: "e@example.com",
        name: "A Staffer", status: pick("status", "active"), active_flag: "true"
      }] };
    }
    for (const [pattern, result] of answers) {
      if (pattern.test(text)) return typeof result === "function" ? result(params) : result;
    }
    return { rows: [] };
  };
}

function mkRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }
  };
}

function fakeMp4() {
  const buf = Buffer.alloc(32);
  buf.write("ftyp", 4);
  return buf;
}

afterEach(() => { db.query = realQuery; });

describe("/api/content/upload", () => {
  test("refuses a closer — owner/admin only", async () => {
    stubDb({ session: { role: "closer", orgId: ORG_A } });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: { fields: { title: "Hi" }, files: [{ filename: "a.mp4", mimeType: "video/mp4", buffer: fakeMp4() }] }
    }, r);
    assert.equal(r.statusCode, 403);
  });

  test("refuses a file that is not a video", async () => {
    stubDb({ session: { role: "owner", orgId: ORG_A } });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        fields: { title: "Nope" },
        files: [{ filename: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello world") }]
      }
    }, r);
    assert.equal(r.statusCode, 400);
    assert.match(r.body.message, /not a video/i);
  });

  test("stores an MP4 and returns the library row", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/INSERT INTO content_videos/i, (params) => ({
          rows: [{
            id: VID, title: params[1], duration_label: params[2],
            mime_type: params[4], byte_size: params[5],
            uploaded_by: params[6], created_at: new Date()
          }]
        })]
      ]
    });
    const r = mkRes();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        fields: { title: "Card Stacking welcome", duration: "2:10" },
        files: [{ filename: "welcome.mp4", mimeType: "video/mp4", buffer: fakeMp4() }]
      }
    }, r);
    assert.equal(r.statusCode, 201);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.video.title, "Card Stacking welcome");
    assert.equal(r.body.video.duration_label, "2:10");
  });
});

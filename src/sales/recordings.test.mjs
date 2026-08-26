import test from "node:test";
import assert from "node:assert/strict";
import {
  filenameMentionsPerson,
  uniqueNameMatch,
  attachDriveRecording,
  listRecentRecordings,
  stampCallTranscript
} from "./recordings.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "550e8400-e29b-41d4-a716-446655440000";

test("filenameMentionsPerson needs both first and last", () => {
  assert.equal(
    filenameMentionsPerson("Strategy session - Jane Doe - 2026-08-15", "Jane", "Doe"),
    true
  );
  assert.equal(filenameMentionsPerson("Meeting with Jane", "Jane", "Doe"), false);
  assert.equal(filenameMentionsPerson("orphan.mp4", "Jane", "Doe"), false);
});

test("uniqueNameMatch attaches only when one client matches", () => {
  const clients = [
    { id: "a", first_name: "Jane", last_name: "Doe" },
    { id: "b", first_name: "John", last_name: "Smith" }
  ];
  assert.equal(
    uniqueNameMatch(clients, "Meet - Jane Doe").id,
    "a"
  );
  assert.equal(
    uniqueNameMatch(
      [{ id: "a", first_name: "Jane", last_name: "Doe" },
       { id: "c", first_name: "Jane", last_name: "Doe" }],
      "Meet - Jane Doe"
    ),
    null
  );
});

test("attachDriveRecording stamps the latest call without a link", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/UPDATE call_outcomes/i.test(sql)) return { rows: [{ id: "co-1" }] };
      if (/UPDATE customer_insights/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };
  const out = await attachDriveRecording(db, {
    orgId: ORG,
    clientId: CLIENT,
    url: "https://drive.google.com/file/d/abc"
  });
  assert.equal(out.attached, true);
  assert.equal(out.clientId, CLIENT);
  assert.equal(seen.length, 2);
});

test("listRecentRecordings is honest when Drive is off and files are empty", async () => {
  const db = {
    async query(sql) {
      if (/brain_drive_sync/i.test(sql)) return { rows: [] };
      if (/brain_files/i.test(sql)) return { rows: [] };
      if (/call_outcomes/i.test(sql)) return { rows: [] };
      if (/FROM clients/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };
  const out = await listRecentRecordings(db, { orgId: ORG, env: {}, now: new Date("2026-08-15T18:00:00Z") });
  assert.equal(out.drive_ready, false);
  assert.ok(out.missing.includes("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"));
  assert.equal(out.items.length, 0);
  assert.match(out.reason, /not connected/i);
});

test("listRecentRecordings returns today's Drive file and name-matches a client", async () => {
  const now = new Date("2026-08-15T18:00:00Z");
  const updates = [];
  const db = {
    async query(sql, params) {
      if (/brain_drive_sync/i.test(sql)) {
        return { rows: [{ last_sync_at: "2026-08-15T17:00:00Z", last_error: null }] };
      }
      if (/FROM brain_files/i.test(sql)) {
        return {
          rows: [{
            id: "bf-1",
            name: "Strategy session - Jane Doe",
            web_view_link: "https://drive.google.com/file/d/rec1",
            client_id: null,
            unattached: true,
            indexed_at: "2026-08-15T16:00:00Z",
            created_at: "2026-08-15T16:00:00Z",
            mime_type: "video/mp4",
            first_name: null,
            last_name: null
          }]
        };
      }
      if (/FROM call_outcomes/i.test(sql) && /SELECT o.id/i.test(sql)) {
        return { rows: [] };
      }
      if (/FROM clients c/i.test(sql)) {
        return { rows: [{ id: CLIENT, first_name: "Jane", last_name: "Doe" }] };
      }
      if (/UPDATE brain_files/i.test(sql)) {
        updates.push(params);
        return { rows: [] };
      }
      if (/UPDATE call_outcomes/i.test(sql) || /UPDATE customer_insights/i.test(sql)) {
        return { rows: [{ id: "x" }] };
      }
      return { rows: [] };
    }
  };
  const env = {
    GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: "sa@test.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n"
    }),
    GOOGLE_DRIVE_DELEGATE_EMAIL: "owner@fundhub.test"
  };
  const out = await listRecentRecordings(db, { orgId: ORG, now, env });
  assert.equal(out.drive_ready, true);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].client_id, CLIENT);
  assert.equal(out.items[0].is_today, true);
  assert.equal(out.items[0].url, "https://drive.google.com/file/d/rec1");
  assert.equal(updates.length, 1);
});

test("stampCallTranscript writes words onto the latest empty call", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/recording_url = \$4/i.test(sql)) return { rows: [] };
      if (/UPDATE call_outcomes/i.test(sql)) return { rows: [{ id: "co-1" }] };
      return { rows: [] };
    }
  };
  const out = await stampCallTranscript(db, {
    orgId: ORG,
    clientId: CLIENT,
    transcript: "the start is part of ten percent"
  });
  assert.equal(out.stamped, 1);
  assert.ok(seen.some((s) => /SET transcript/i.test(s.sql)));
});

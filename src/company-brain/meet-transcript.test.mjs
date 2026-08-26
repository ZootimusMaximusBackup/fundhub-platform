import test from "node:test";
import assert from "node:assert/strict";
import { applyMeetWords, pairMeetTranscripts, sweepMeetTranscripts } from "./meet-transcript.mjs";
import { SWEEP_CRON } from "../workflows/meet-transcript-sweeper.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "550e8400-e29b-41d4-a716-446655440000";

test("pairMeetTranscripts copies sibling transcript words onto the recording", async () => {
  const upserts = [];
  const db = {
    async query(sql, params) {
      if (/needs_transcription = true/i.test(sql)) {
        return {
          rows: [{
            id: "bf-rec",
            drive_file_id: "drv-rec",
            name: "Funding Call - Jane Doe - Recording.mp4",
            mime_type: "video/mp4",
            web_view_link: "https://drive.google.com/file/d/rec",
            client_id: CLIENT
          }]
        };
      }
      if (/needs_transcription = false/i.test(sql)) {
        return {
          rows: [{
            id: "bf-doc",
            name: "Funding Call - Jane Doe - Transcript"
          }]
        };
      }
      if (/FROM brain_chunks/i.test(sql)) {
        assert.equal(params[0], "bf-doc");
        return { rows: [{ content: "Closer: the start is three thousand." }] };
      }
      if (/UPDATE call_outcomes SET transcript/i.test(sql)) {
        return { rows: [{ id: "call-1" }] };
      }
      return { rows: [] };
    }
  };
  const out = await pairMeetTranscripts(db, {
    orgId: ORG,
    upsert: async (_db, args) => {
      upserts.push(args);
      return { ok: true, fileId: "bf-rec" };
    }
  });
  assert.equal(out.applied, 1);
  assert.equal(upserts.length, 1);
  assert.match(upserts[0].extracted.text, /three thousand/);
  assert.equal(upserts[0].extracted.needsTranscription, false);
});

test("pairMeetTranscripts does not guess when two docs share a stem", async () => {
  const db = {
    async query(sql) {
      if (/needs_transcription = true/i.test(sql)) {
        return {
          rows: [{
            id: "bf-rec",
            drive_file_id: "drv-rec",
            name: "Call - Recording.mp4",
            mime_type: "video/mp4",
            web_view_link: null,
            client_id: null
          }]
        };
      }
      if (/needs_transcription = false/i.test(sql)) {
        return {
          rows: [
            { id: "a", name: "Call - Transcript" },
            { id: "b", name: "Call - Gemini notes" }
          ]
        };
      }
      if (/FROM brain_chunks/i.test(sql)) {
        return { rows: [{ content: "words" }] };
      }
      return { rows: [] };
    }
  };
  const out = await pairMeetTranscripts(db, {
    orgId: ORG,
    upsert: async () => {
      throw new Error("should not upsert");
    }
  });
  assert.equal(out.applied, 0);
});

test("applyMeetWords stamps spoken words when the file name is the person", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/FROM clients/i.test(sql)) {
        return { rows: [{ id: CLIENT, first_name: "Jane", last_name: "Doe" }] };
      }
      if (/UPDATE call_outcomes SET recording_url/i.test(sql)) {
        return { rows: [{ id: "call-1" }] };
      }
      if (/UPDATE call_outcomes SET transcript/i.test(sql)) {
        return { rows: [{ id: "call-1" }] };
      }
      return { rows: [] };
    }
  };
  const out = await applyMeetWords(db, {
    orgId: ORG,
    extracted: {
      fileId: "drv-rec",
      name: "Google Meet Recording - Jane Doe",
      webViewLink: "https://drive.google.com/file/d/rec",
      clientId: null
    },
    text: "the start is three thousand",
    upsert: async () => ({ ok: true, fileId: "bf-rec" })
  });
  assert.equal(out.ok, true);
  const stamp = seen.find((s) => /SET transcript/i.test(s.sql));
  assert.ok(stamp, "transcriber must write spoken words onto the call row");
  assert.equal(stamp.params[2], "the start is three thousand");
});

test("Meet word sweeper stays on a ten-minute keep-alive", () => {
  assert.equal(SWEEP_CRON, "*/10 * * * *");
});

test("sweepMeetTranscripts walks each org with pending tapes", async () => {
  const orgs = [];
  const db = {
    async query(sql) {
      if (/SELECT DISTINCT org_id/i.test(sql)) {
        return { rows: [{ org_id: ORG }] };
      }
      if (/needs_transcription = true/i.test(sql)) {
        orgs.push(ORG);
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  const out = await sweepMeetTranscripts(db);
  assert.equal(out.orgs, 1);
  assert.equal(out.paired, 0);
  assert.equal(orgs.length, 1);
});

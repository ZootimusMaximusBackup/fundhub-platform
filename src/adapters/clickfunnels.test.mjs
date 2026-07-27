import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  verifyClickFunnelsSignature,
  normalizeClickFunnelsEvent,
  mapToCanonical,
  handleClickFunnelsWebhook
} from "./clickfunnels.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";

// Fake db — same fakeDb helper as commas.test.mjs.
function fakeDb({ dedup = false, store = [] } = {}) {
  let n = 0;
  return {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        if (dedup) return { rows: [] };
        const row = { id: `evt-${++n}` };
        store.push({ ...row, name: params[1], payload: params[5] });
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

const SECRET = "whsec_cf_test";
const sign = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");

// --- signature ---------------------------------------------------------------
test("verifyClickFunnelsSignature: accepts valid sig, rejects tampered / missing / no-secret", () => {
  const raw = JSON.stringify({ event: "form_submission" });
  assert.equal(verifyClickFunnelsSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyClickFunnelsSignature(raw, "sha256=" + sign(raw), SECRET), true); // prefixed variant
  assert.equal(verifyClickFunnelsSignature(raw, sign(raw + "x"), SECRET), false); // tampered
  assert.equal(verifyClickFunnelsSignature(raw, "", SECRET), false);              // missing header
  assert.equal(verifyClickFunnelsSignature(raw, sign(raw), null), false);         // no secret => closed
});

// --- normalize ---------------------------------------------------------------
test("normalizeClickFunnelsEvent: reads CF 2.0 shape (data.contact)", () => {
  const evt = normalizeClickFunnelsEvent({
    id: "sub_abc123",
    event: "contact_created",
    funnel_name: "Free Credit Audit",
    data: {
      contact: {
        email: "JANE@EXAMPLE.COM",
        first_name: "Jane",
        last_name: "Doe",
        phone: "555-123-4567"
      }
    }
  });
  assert.equal(evt.email, "jane@example.com");
  assert.equal(evt.name, "Jane Doe");
  assert.equal(evt.phone, "555-123-4567");
  assert.equal(evt.funnel, "Free Credit Audit");
  assert.equal(evt.id, "sub_abc123");
  assert.equal(evt.answers, null);
  assert.equal(evt.a1, null);
  assert.equal(evt.a2, null);
});

test("normalizeClickFunnelsEvent: extracts a1/a2 referral params from top-level", () => {
  const evt = normalizeClickFunnelsEvent({
    id: "sub_ref1",
    a1: "affiliate-abc",
    a2: "sub-affiliate-xyz",
    data: { contact: { email: "ref@example.com", first_name: "Ref" } }
  });
  assert.equal(evt.a1, "affiliate-abc");
  assert.equal(evt.a2, "sub-affiliate-xyz");
});

test("normalizeClickFunnelsEvent: reads CF Classic top-level contact shape", () => {
  const evt = normalizeClickFunnelsEvent({
    type: "new_purchase",
    contact: {
      email: "bob@example.com",
      full_name: "Bob Smith",
      phone_number: "555-999-0000"
    },
    funnel: "Main Funnel"
  });
  assert.equal(evt.email, "bob@example.com");
  assert.equal(evt.name, "Bob Smith");
  assert.equal(evt.phone, "555-999-0000");
  assert.equal(evt.funnel, "Main Funnel");
});

test("normalizeClickFunnelsEvent: reads survey answers from data.survey_answers", () => {
  const answers = { q1: "Yes", q2: "750+" };
  const evt = normalizeClickFunnelsEvent({
    id: "sub_survey_1",
    data: {
      contact: { email: "alice@example.com", first_name: "Alice", last_name: "A" },
      survey_answers: answers
    }
  });
  assert.deepEqual(evt.answers, answers);
  assert.equal(evt.email, "alice@example.com");
});

test("normalizeClickFunnelsEvent: reads survey from data.formData (CF 2.0 variant)", () => {
  const formData = [{ field: "q1", value: "No" }];
  const evt = normalizeClickFunnelsEvent({
    data: {
      contact: { email: "carol@example.com" },
      formData
    }
  });
  assert.deepEqual(evt.answers, formData);
});

// --- mapToCanonical ----------------------------------------------------------
test("mapToCanonical: email-only lead => entry.captured only", () => {
  const names = mapToCanonical({ email: "a@b.com", answers: null }).map((c) => c.name);
  assert.deepEqual(names, ["entry.captured"]);
});

test("mapToCanonical: lead + survey => entry.captured + survey.submitted", () => {
  const names = mapToCanonical({ email: "a@b.com", answers: { q1: "Yes" } }).map((c) => c.name);
  assert.deepEqual(names, ["entry.captured", "survey.submitted"]);
});

test("mapToCanonical: no email => empty array", () => {
  assert.deepEqual(mapToCanonical({ email: "", answers: null }), []);
  assert.deepEqual(mapToCanonical(null), []);
});

// --- full adapter ------------------------------------------------------------
test("handleClickFunnelsWebhook: bad signature => 401, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = JSON.stringify({ event: "form_submission", data: { contact: { email: "x@y.com" } } });
  const res = await handleClickFunnelsWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: "bad", secret: SECRET });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.emitted.length, 0);
});

test("handleClickFunnelsWebhook: lead without survey => entry.captured only, handler fires", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("entry.captured", (e) => seen.push(e.name));
  const raw = JSON.stringify({
    id: "cf_lead_1",
    event: "contact_created",
    funnel_name: "Free Audit Funnel",
    data: { contact: { email: "lead@example.com", first_name: "Lead", last_name: "User", phone: "555-000-1111" } }
  });
  const res = await handleClickFunnelsWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(res.emitted.map((e) => e.name), ["entry.captured"]);
  assert.deepEqual(seen, ["entry.captured"]);
});

test("handleClickFunnelsWebhook: lead + survey => entry.captured + survey.submitted, both handlers fire", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("entry.captured", (e) => seen.push(e.name));
  on("survey.submitted", (e) => seen.push(e.name));
  const raw = JSON.stringify({
    id: "cf_survey_42",
    event: "form_submission",
    data: {
      contact: { email: "quiz@example.com", first_name: "Quiz", last_name: "Taker", phone: "555-777-8888" },
      survey_answers: { q1: "Yes", q2: "Good" }
    }
  });
  const res = await handleClickFunnelsWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.deepEqual(res.emitted.map((e) => e.name), ["entry.captured", "survey.submitted"]);
  assert.deepEqual(seen.sort(), ["entry.captured", "survey.submitted"]);
  // survey payload includes answers
  assert.equal(res.emitted.find((e) => e.name === "survey.submitted") !== undefined, true);
});

test("handleClickFunnelsWebhook: a1/a2 referral params flow into entry.captured payload", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        store.push({ name: params[1], payload: params[5] });
        return { rows: [{ id: "evt-1" }] };
      }
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    id: "cf_ref_42",
    a1: "tier1-aff",
    a2: "tier2-aff",
    event: "contact_created",
    data: { contact: { email: "reftest@example.com", first_name: "Ref" } }
  });
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  const entryPayload = store.find((r) => r.name === "entry.captured")?.payload;
  assert.equal(entryPayload?.a1, "tier1-aff");
  assert.equal(entryPayload?.a2, "tier2-aff");
});

test("handleClickFunnelsWebhook: no_email => 200, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = JSON.stringify({ id: "cf_noemail", event: "form_submission", data: { contact: { first_name: "Ghost" } } });
  const res = await handleClickFunnelsWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.reason, "no_email");
  assert.equal(res.emitted.length, 0);
});

test("handleClickFunnelsWebhook: idempotent re-delivery (deduped, no handler dispatch)", async () => {
  _resetOrgCache(); clearHandlers();
  let fired = 0;
  on("entry.captured", () => (fired += 1));
  const raw = JSON.stringify({
    id: "cf_idem_1",
    event: "contact_created",
    data: { contact: { email: "idem@example.com" } }
  });
  const db = fakeDb({ dedup: true });
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.ok(res.emitted.every((e) => e.deduped === true), "all events must be deduped");
  assert.equal(fired, 0, "handler must not fire on deduped replay");
});

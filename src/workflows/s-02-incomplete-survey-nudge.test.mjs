import { test } from "node:test";
import assert from "node:assert";
import { handle, surveyCompleted, EMAIL_TEMPLATE_KEY } from "./s-02-incomplete-survey-nudge.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: survey still incomplete after the wait sends the nudge", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "finish it", compliance_passed: true }]
  });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.nudged, true);
  assert.equal(db.messages.length, 1);
});

test("branch: survey completed during the wait — tag instead of nudge", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "survey.submitted" }]
  });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.nudged, false);
  assert.deepEqual(db.clients[0].tags, ["survey:complete"]);
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying does not double-send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "finish it", compliance_passed: true }]
  });
  const event = ev("entry.captured", {}, { id: "evt-dup-s02", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 1);
});

// T14-11 regression: capture sources that predate the client_id fix wrote
// survey.submitted with client_id NULL. Before this, the completion check could
// never see those rows, so people who HAD finished the survey were still nudged.
function eventsDb(rows) {
  return {
    query: async (sql, params) => {
      assert.match(sql, /SELECT DISTINCT name FROM events/);
      const [clientId, names, addr] = params;
      const hits = rows
        .filter((e) => names.includes(e.name))
        .filter((e) => e.client_id === clientId || (addr !== "" && e.email === addr));
      return { rows: hits.map((e) => ({ name: e.name })) };
    },
  };
}

test("surveyCompleted matches a survey.submitted row that has no client_id, by email", async () => {
  const db = eventsDb([{ client_id: null, name: "survey.submitted", email: "a@b.com" }]);
  assert.equal(await surveyCompleted(db, "cl-1", "a@b.com"), true);
  assert.equal(await surveyCompleted(db, "cl-1", "A@B.com"), true, "email compare is case-insensitive");
  assert.equal(await surveyCompleted(db, "cl-1", null), false, "no email and no client_id link → not completed");
});

test("surveyCompleted still matches on client_id alone", async () => {
  const db = eventsDb([{ client_id: "cl-1", name: "survey.submitted", email: null }]);
  assert.equal(await surveyCompleted(db, "cl-1", null), true);
  assert.equal(await surveyCompleted(db, "cl-2", null), false);
});

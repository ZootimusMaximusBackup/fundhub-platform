// The two exit checks that are pure: the escalation screen and the contact
// check. The eight database-backed ones are proved in run.pg.test.mjs against a
// real Postgres, because a mock cannot prove a unique index.

import { test } from "node:test";
import assert from "node:assert";
import { looksLikeEscalation, contactFor, CHASEABLE_STATES, BOUGHT_STATUSES } from "./exits.mjs";

test("language aimed at us stops the chase", () => {
  for (const said of [
    "I'm getting a lawyer",
    "my attorney will be in touch",
    "I will sue you",
    "this is going to be a lawsuit",
    "starting litigation",
    "I'm taking legal action",
    "see you in small claims",
    "stop harassing me",
    "I'm filing a complaint against Fundhub",
    "this is a scam"
  ]) {
    assert.equal(looksLikeEscalation(said), true, said);
  }
});

test("a client doing exactly what we asked them to do is NOT an escalation", () => {
  // Our own product hands them a CFPB form and a state AG form and tells them
  // to file both. A keyword list that read these as threats would stop every
  // ladder the client has, for following instructions.
  for (const said of [
    "I filed the CFPB one yesterday",
    "should I send the attorney general form too?",
    "the attorney general complaint is ready to go",
    "I want to file a complaint with the CFPB",
    "there is a fraud alert on my file",
    "that account was fraudulent, it wasn't mine"
  ]) {
    assert.equal(looksLikeEscalation(said), false, said);
  }
});

test("an empty or missing message is not an escalation", () => {
  assert.equal(looksLikeEscalation(null), false);
  assert.equal(looksLikeEscalation(undefined), false);
  assert.equal(looksLikeEscalation(""), false);
});

test("no phone means no sms address — the step is skippable, not retryable", () => {
  assert.equal(contactFor({ phone: null }, "sms"), null);
  assert.equal(contactFor({ phone: "" }, "sms"), null);
  assert.equal(contactFor({ phone: "  " }, "sms"), null);
  assert.equal(contactFor({ phone: "555" }, "sms"), null);
  assert.equal(contactFor({ phone: "+15555550123" }, "sms"), "+15555550123");
});

test("a do-not-disturb flag removes the address for that channel only", () => {
  const client = { phone: "+15555550123", email: "a@b.com", dnd_sms: true };
  assert.equal(contactFor(client, "sms"), null);
  assert.equal(contactFor(client, "email"), "a@b.com");
  assert.equal(contactFor({ ...client, dnd_sms: false, dnd_email: true }, "email"), null);
});

test("an address that is not shaped like an address is not an address", () => {
  assert.equal(contactFor({ email: "not-an-email" }, "email"), null);
  assert.equal(contactFor({ email: "a@b" }, "email"), null);
  assert.equal(contactFor({ email: "a@b.com" }, "email"), "a@b.com");
});

test("an unknown channel has no address", () => {
  assert.equal(contactFor({ phone: "+15555550123" }, "voice"), null);
  assert.equal(contactFor({ phone: "+15555550123" }, "carrier pigeon"), null);
});

test("only not_started and in_progress are chased", () => {
  assert.deepEqual([...CHASEABLE_STATES].sort(), ["in_progress", "not_started"]);
  for (const state of ["done", "skipped", "blocked"]) {
    assert.equal(CHASEABLE_STATES.has(state), false, state);
  }
});

test("a quote nobody accepted does not count as having bought the paid alternative", () => {
  assert.equal(BOUGHT_STATUSES.has("quoted"), false);
  assert.equal(BOUGHT_STATUSES.has("awaiting_payment"), false);
  assert.equal(BOUGHT_STATUSES.has("paid"), true);
  assert.equal(BOUGHT_STATUSES.has("fulfilled"), true);
});

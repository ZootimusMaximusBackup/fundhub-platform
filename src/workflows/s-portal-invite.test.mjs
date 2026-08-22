import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./s-portal-invite.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("portal invite: booking.created requests a magic link for the client email", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }]
  });
  const calls = [];
  const res = await handle({
    event: ev("booking.created", { email: "a@b.com" }, { clientId: "cl-1" }),
    db,
    step: fakeStep(),
    requestMagicLinkImpl: async (_db, args) => {
      calls.push(args);
      return { ok: true, outcome: "issued", sent: true };
    }
  });
  assert.equal(res.done, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].email, "a@b.com");
  assert.equal(calls[0].orgId, "org-1");
});

test("portal invite: second booking.created does not send again", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }]
  });
  const calls = [];
  const requestMagicLinkImpl = async (_db, args) => {
    calls.push(args);
    return { ok: true, outcome: "issued", sent: true };
  };
  const first = await handle({
    event: ev("booking.created", { email: "a@b.com" }, { id: "evt-1", clientId: "cl-1" }),
    db, step: fakeStep(), requestMagicLinkImpl
  });
  const second = await handle({
    event: ev("booking.created", { email: "a@b.com" }, { id: "evt-2", clientId: "cl-1" }),
    db, step: fakeStep(), requestMagicLinkImpl
  });
  assert.equal(first.done, true);
  assert.equal(second.done, false);
  assert.equal(second.reason, "already_locked");
  assert.equal(calls.length, 1);
});

test("portal invite: no email — skip", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: null, custom_fields: {} }]
  });
  const res = await handle({
    event: ev("booking.created", {}, { clientId: "cl-1" }),
    db,
    step: fakeStep(),
    requestMagicLinkImpl: async () => { throw new Error("should not send"); }
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_email");
});

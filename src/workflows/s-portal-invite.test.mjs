import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./s-portal-invite.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("portal invite: booking.created does not send EMAIL-PORTAL-MAGIC-LINK", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }]
  });
  const res = await handle({
    event: ev("booking.created", { email: "a@b.com" }, { clientId: "cl-1" }),
    db,
    step: fakeStep(),
    requestMagicLinkImpl: async () => { throw new Error("should not send"); }
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "owned_by_s04b");
});

test("portal invite: second booking.created still does not send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }]
  });
  const first = await handle({
    event: ev("booking.created", { email: "a@b.com" }, { id: "evt-1", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  const second = await handle({
    event: ev("booking.created", { email: "a@b.com" }, { id: "evt-2", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(first.done, false);
  assert.equal(first.reason, "owned_by_s04b");
  assert.equal(second.done, false);
  assert.equal(second.reason, "owned_by_s04b");
});

test("portal invite: no email — still owned by confirm, not a send", async () => {
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
  assert.equal(res.reason, "owned_by_s04b");
});

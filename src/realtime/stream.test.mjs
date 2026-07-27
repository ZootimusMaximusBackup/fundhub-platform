import { test } from "node:test";
import assert from "node:assert";
import { emit } from "../events/bus.mjs";
import { getHandlers } from "../events/registry.mjs";
import { subscribe, _subscriberCount } from "./stream.mjs";

// Fake db: routes by SQL keyword, mirrors src/events/bus.test.mjs's fakeDb()
// exactly — satisfies the org-resolution SELECT and the INSERT ... RETURNING
// id used by emit(). No real Postgres involved.
function fakeDb() {
  let n = 0;
  return {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        const row = { id: `evt-${++n}` };
        return { rows: [row] };
      }
      return { rows: [] };
    },
  };
}

test("subscribe: multiple simultaneous subscribers all receive the same emitted event", async () => {
  const db = fakeDb();
  const receivedA = [];
  const receivedB = [];
  const unsubA = subscribe((chunk) => receivedA.push(chunk));
  const unsubB = subscribe((chunk) => receivedB.push(chunk));

  await emit(db, "deposit.paid", { amount: 500 }, { clientId: "c1" });

  assert.equal(receivedA.length, 1, "subscriber A should receive the event");
  assert.equal(receivedB.length, 1, "subscriber B should also receive the event");
  for (const chunk of [receivedA[0], receivedB[0]]) {
    assert.match(chunk, /^id: evt-\d+\n/);
    assert.match(chunk, /event: deposit\.paid\n/);
    assert.match(chunk, /"amount":500/);
    assert.match(chunk, /"client_id":"c1"/);
    assert.match(chunk, /"observed_at":"/);
    assert.match(chunk, /\n\n$/);
  }

  unsubA();
  unsubB();
});

test("unsubscribe: a disconnected subscriber stops receiving further events; others keep receiving", async () => {
  const db = fakeDb();
  const receivedA = [];
  const receivedB = [];
  const unsubA = subscribe((chunk) => receivedA.push(chunk));
  const unsubB = subscribe((chunk) => receivedB.push(chunk));

  await emit(db, "sale.closed", { n: 1 }, {});
  assert.equal(receivedA.length, 1);
  assert.equal(receivedB.length, 1);

  unsubA();

  await emit(db, "sale.closed", { n: 2 }, {});
  assert.equal(receivedA.length, 1, "unsubscribed subscriber must NOT receive further events");
  assert.equal(receivedB.length, 2, "still-connected subscriber must keep receiving events");

  unsubB();
});

test("events filter: subscribing with an events list narrows delivery to only those event names", async () => {
  const db = fakeDb();
  const received = [];
  const unsub = subscribe((chunk) => received.push(chunk), { events: ["deposit.paid"] });

  await emit(db, "sale.closed", { unrelated: true }, {}); // not in filter — must be skipped
  await emit(db, "deposit.paid", { amount: 42 }, {}); // in filter — must be delivered

  assert.equal(received.length, 1, "only the filtered event name should be delivered");
  assert.match(received[0], /event: deposit\.paid\n/);
  assert.match(received[0], /"amount":42/);

  unsub();
});

test("CRITICAL: a throwing subscriber write() does not break dispatch for other subscribers, and emit() does not reject", async () => {
  const db = fakeDb();
  const good = [];
  const unsubBad = subscribe(() => {
    throw new Error("simulated broken pipe");
  });
  const unsubGood = subscribe((chunk) => good.push(chunk));

  await assert.doesNotReject(
    () => emit(db, "round.funded", { n: 1 }, {}),
    "emit() must not reject even if one subscriber's write() throws"
  );

  assert.equal(good.length, 1, "the other subscriber must still receive the event");

  unsubBad();
  unsubGood();
});

test("subscribe: registering additional subscribers costs no extra bus registration (idempotent registration)", async () => {
  const before = getHandlers("entry.captured").length;

  const unsub1 = subscribe(() => {});
  const afterFirst = getHandlers("entry.captured").length;

  const unsub2 = subscribe(() => {});
  const unsub3 = subscribe(() => {});
  const afterMore = getHandlers("entry.captured").length;

  assert.equal(afterFirst, afterMore, "adding more subscribers must not register new bus handlers");
  assert.ok(afterFirst <= before + 1, "at most one handler is ever added for this event name");

  unsub1();
  unsub2();
  unsub3();
});

test("subscribe/unsubscribe manage the subscriber map correctly", async () => {
  const startCount = _subscriberCount();
  const unsub1 = subscribe(() => {});
  assert.equal(_subscriberCount(), startCount + 1);
  const unsub2 = subscribe(() => {});
  assert.equal(_subscriberCount(), startCount + 2);
  unsub1();
  assert.equal(_subscriberCount(), startCount + 1);
  unsub2();
  assert.equal(_subscriberCount(), startCount);
});

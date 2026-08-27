// Real-Postgres integration test for subscriptions and the card on file.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// What this proves that the unit tests cannot: the 075 and 076 constraints are
// real. Half of these tests write RAW SQL rather than calling the store, on
// purpose — the store refusing a bad write proves the store is careful, and
// what has to be true is that the DATABASE refuses it, for every writer that
// ever exists. The other half check the behaviours the store owns: the plan
// change is atomic, a card refresh does not reinstate a removed card, and an
// unknown price survives as NULL.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  putClientCard, listClientCards, removeClientCard,
  startSubscription, getSubscriptionAt, listSubscriptions,
  changeTier, cancelSubscription, attachCard, SubscriptionConflictError
} from "./store.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "subscriptions_pg_test@example.com";
const OTHER_EMAIL = "subscriptions_pg_test_other@example.com";

let orgId = null;
let clientId = null;
let otherClientId = null;

async function wipe() {
  // subscriptions first: 076's foreign key on client_cards is ON DELETE RESTRICT.
  await db.query(
    `DELETE FROM subscriptions WHERE client_id IN (SELECT id FROM clients WHERE email = ANY($1))`,
    [[EMAIL, OTHER_EMAIL]]
  );
  await db.query(
    `DELETE FROM client_cards WHERE client_id IN (SELECT id FROM clients WHERE email = ANY($1))`,
    [[EMAIL, OTHER_EMAIL]]
  );
  await db.query(`DELETE FROM clients WHERE email = ANY($1)`, [[EMAIL, OTHER_EMAIL]]);
}

/** Clear this client's rows between tests so each one states its own setup. */
async function reset() {
  await db.query(`DELETE FROM subscriptions WHERE client_id = ANY($1)`, [[clientId, otherClientId]]);
  await db.query(`DELETE FROM client_cards WHERE client_id = ANY($1)`, [[clientId, otherClientId]]);
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Sub','Scriber') RETURNING id`,
    [orgId, EMAIL]
  )).rows[0].id;
  otherClientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Other','Client') RETURNING id`,
    [orgId, OTHER_EMAIL]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

// ---------------------------------------------------------------------------
// the card on file — what the database itself refuses
// ---------------------------------------------------------------------------

test("the database refuses a card number in the token column, whatever writes it", { skip: !HAS_DB }, async () => {
  await reset();
  for (const pan of ["4242424242424242", "4242 4242 4242 4242", "4242-4242-4242-4242", "378282246310005"]) {
    await assert.rejects(
      () => db.query(
        `INSERT INTO client_cards (org_id, client_id, provider_token) VALUES ($1,$2,$3)`,
        [orgId, clientId, pan]
      ),
      /client_cards_token_not_pan/,
      `a raw PAN (${pan}) must not be storable`
    );
  }
});

test("the database refuses anything but four digits in last4", { skip: !HAS_DB }, async () => {
  await reset();
  for (const bad of ["4242424242424242", "424", "42a2", ""]) {
    await assert.rejects(
      () => db.query(
        `INSERT INTO client_cards (org_id, client_id, provider_token, last4) VALUES ($1,$2,'tok_shape',$3)`,
        [orgId, clientId, bad]
      ),
      /client_cards_last4_shape/,
      `last4 "${bad}" must be refused`
    );
  }
});

test("the database refuses an impossible expiry", { skip: !HAS_DB }, async () => {
  await reset();
  await assert.rejects(
    () => db.query(`INSERT INTO client_cards (org_id, client_id, provider_token, exp_month) VALUES ($1,$2,'tok_e1',13)`, [orgId, clientId]),
    /client_cards_expiry/
  );
  await assert.rejects(
    () => db.query(`INSERT INTO client_cards (org_id, client_id, provider_token, exp_year) VALUES ($1,$2,'tok_e2',29)`, [orgId, clientId]),
    /client_cards_expiry/,
    "a two-digit year would compare as the year 29 and read as expired"
  );
});

test("there is no column on client_cards that could hold a card number or a security code", { skip: !HAS_DB }, async () => {
  const cols = (await db.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'client_cards' ORDER BY column_name`
  )).rows;
  const names = cols.map((c) => c.column_name);
  assert.deepEqual(names, [
    "brand", "client_id", "created_at", "exp_month", "exp_year", "id",
    // is_demo is the Demo Mode flag (148_demo_mode.sql), added across the
    // tenant tables. It holds a boolean, never card data, and it is listed
    // here rather than the list being loosened: the point of this assertion is
    // that EVERY column is named on purpose.
    "is_demo",
    "last4", "org_id", "provider", "provider_token", "removed_at", "updated_at"
  ], "a new column here needs a very good reason — this list is the promise");

  /* And the promise restated as the thing it actually protects, so a future
     column cannot slip in under a name nobody reads carefully. */
  for (const c of cols) {
    assert.doesNotMatch(c.column_name, /(^|_)(pan|cvv|cvc|card_number|security_code|full_number)($|_)/,
      `client_cards.${c.column_name} looks like it could hold a card number or security code`);
  }
  for (const forbidden of ["pan", "card_number", "cvv", "cvc", "security_code", "encrypted_pan"]) {
    assert.equal(names.includes(forbidden), false, `${forbidden} must never exist`);
  }
  // Nor a jsonb blob a whole payload could be dropped into.
  assert.equal(cols.some((c) => c.data_type === "jsonb"), false,
    "no jsonb column — that is where a full payload gets parked");
});

// ---------------------------------------------------------------------------
// the card on file — what the store does
// ---------------------------------------------------------------------------

test("putClientCard stores an instrument and refreshing it neither erases nor reinstates", { skip: !HAS_DB }, async () => {
  await reset();
  const card = await putClientCard(db, {
    orgId, clientId, providerToken: "tok_live_abc",
    brand: "Visa", last4: "4242", expMonth: 4, expYear: 2029
  });
  assert.equal(card.last4, "4242");
  assert.equal(card.brand, "Visa");

  // Same token, metadata omitted: absence is not a correction.
  const refreshed = await putClientCard(db, { orgId, clientId, providerToken: "tok_live_abc" });
  assert.equal(refreshed.id, card.id, "the same token is the same instrument, not a second row");
  assert.equal(refreshed.brand, "Visa", "an omitted brand must not blank the one we had");
  assert.equal(refreshed.last4, "4242");

  const removed = await removeClientCard(db, { orgId, id: card.id });
  assert.ok(removed.removed_at, "removal is recorded, not a delete");

  const afterRemoval = await putClientCard(db, {
    orgId, clientId, providerToken: "tok_live_abc", brand: "Visa", last4: "4242"
  });
  assert.ok(afterRemoval.removed_at,
    "storing the token again is a metadata refresh, NOT the client asking to be charged again");

  assert.equal((await listClientCards(db, { orgId, clientId })).length, 0,
    "a removed card is not offered as usable");
  assert.equal((await listClientCards(db, { orgId, clientId, includeRemoved: true })).length, 1,
    "but it stays readable, because a past charge has to stay explainable");
});

test("removeClientCard keeps the first removal date and never throws on a second call", { skip: !HAS_DB }, async () => {
  await reset();
  const card = await putClientCard(db, { orgId, clientId, providerToken: "tok_rm_1" });
  const first = await removeClientCard(db, { orgId, id: card.id });
  const second = await removeClientCard(db, { orgId, id: card.id });
  assert.deepEqual(second.removed_at, first.removed_at,
    "the removal date answers 'when did they take it off file' — a retry must not move it");
});

test("a token already on file for another client is refused, not silently handed over", { skip: !HAS_DB }, async () => {
  await reset();
  await putClientCard(db, { orgId, clientId, providerToken: "tok_shared" });
  await assert.rejects(
    () => putClientCard(db, { orgId, clientId: otherClientId, providerToken: "tok_shared" }),
    /already on file for a different client/
  );
});

test("putClientCard refuses a PAN before it reaches the database", { skip: !HAS_DB }, async () => {
  await reset();
  await assert.rejects(
    () => putClientCard(db, { orgId, clientId, providerToken: "4242424242424242" }),
    /shaped like a card number/
  );
  await assert.rejects(
    () => putClientCard(db, { orgId, clientId, providerToken: "tok_ok", cvv: "123" }),
    /never be sent/
  );
});

// ---------------------------------------------------------------------------
// subscriptions
// ---------------------------------------------------------------------------

test("startSubscription opens a live version and getSubscriptionAt finds it", { skip: !HAS_DB }, async () => {
  await reset();
  const sub = await startSubscription(db, { orgId, clientId, tier: "starter", priceCents: 9900 });
  assert.equal(sub.tier, "starter");
  assert.equal(Number(sub.price_cents), 9900);
  assert.equal(sub.status, "active");
  assert.equal(sub.effective_to, null);
  assert.equal(sub.currency, "USD");

  const live = await getSubscriptionAt(db, { orgId, clientId });
  assert.equal(live.id, sub.id);
});

test("an unrecorded price is stored as NULL and stays NULL", { skip: !HAS_DB }, async () => {
  await reset();
  const sub = await startSubscription(db, { orgId, clientId, tier: "unpriced-tier" });
  assert.equal(sub.price_cents, null,
    "no tier price exists as a row anywhere in this repo — NULL is the honest answer, 0 is not");
  const reread = await getSubscriptionAt(db, { orgId, clientId });
  assert.equal(reread.price_cents, null);
});

test("the database refuses a second live subscription for the same client", { skip: !HAS_DB }, async () => {
  await reset();
  await startSubscription(db, { orgId, clientId, tier: "starter", priceCents: 9900 });
  await assert.rejects(
    () => db.query(
      `INSERT INTO subscriptions (org_id, client_id, tier, price_cents) VALUES ($1,$2,'pro',19900)`,
      [orgId, clientId]
    ),
    /subscriptions_no_overlap/,
    "a double-submitted signup must be stopped by the database, not by a check in JS"
  );
});

test("changeTier closes the live version and opens its successor in one statement", { skip: !HAS_DB }, async () => {
  await reset();
  const first = await startSubscription(db, {
    orgId, clientId, tier: "starter", priceCents: 9900,
    at: new Date(Date.now() - 86_400_000).toISOString()
  });
  const second = await changeTier(db, { orgId, clientId, tier: "pro", priceCents: 19900 });

  assert.notEqual(second.id, first.id, "a plan change opens a row — it never edits one");
  assert.equal(second.tier, "pro");
  assert.equal(Number(second.price_cents), 19900);
  assert.equal(second.effective_to, null);

  const history = await listSubscriptions(db, { orgId, clientId });
  assert.equal(history.length, 2, "both versions survive");
  const closed = history.find((r) => r.id === first.id);
  assert.ok(closed.effective_to, "the old version is closed, not deleted");
  assert.equal(Number(closed.price_cents), 9900, "history still says what they used to pay");
  assert.deepEqual(closed.effective_to, second.effective_from,
    "the windows meet exactly, so no instant is covered twice or missed");

  const live = await getSubscriptionAt(db, { orgId, clientId });
  assert.equal(live.id, second.id, "exactly one version is live at any instant");
});

test("changeTier carries the card and the processor reference forward", { skip: !HAS_DB }, async () => {
  await reset();
  const card = await putClientCard(db, { orgId, clientId, providerToken: "tok_carry", last4: "1111" });
  await startSubscription(db, {
    orgId, clientId, tier: "starter", priceCents: 9900,
    cardId: card.id, providerRef: "sub_ext_1",
    at: new Date(Date.now() - 86_400_000).toISOString()
  });
  const next = await changeTier(db, { orgId, clientId, tier: "pro", priceCents: 19900 });
  assert.equal(next.card_id, card.id, "the client did not change how they pay");
  assert.equal(next.provider_ref, "sub_ext_1", "the processor's subscription is the same subscription");
});

test("the same processor reference may repeat down the version chain but not across two live rows", { skip: !HAS_DB }, async () => {
  await reset();
  await startSubscription(db, {
    orgId, clientId, tier: "starter", priceCents: 9900, providerRef: "sub_ext_2",
    at: new Date(Date.now() - 86_400_000).toISOString()
  });
  // The plan change above already proves the chain case; this is the other half.
  await assert.rejects(
    () => db.query(
      `INSERT INTO subscriptions (org_id, client_id, tier, provider_ref) VALUES ($1,$2,'pro','sub_ext_2')`,
      [orgId, otherClientId]
    ),
    /subscriptions_provider_ref_uq/,
    "one processor subscription cannot be live on two client records at once"
  );
});

test("a live row's price cannot be updated — the trigger sends you to open a version", { skip: !HAS_DB }, async () => {
  await reset();
  const sub = await startSubscription(db, { orgId, clientId, tier: "starter", priceCents: 9900 });
  await assert.rejects(
    () => db.query(`UPDATE subscriptions SET price_cents = 100 WHERE id = $1`, [sub.id]),
    /close this row .effective_to. and INSERT the new terms/,
    "this is the one-line upgrade that would rewrite every past period at once"
  );
  await assert.rejects(
    () => db.query(`UPDATE subscriptions SET tier = 'pro' WHERE id = $1`, [sub.id]),
    /immutable/
  );
  await assert.rejects(
    () => db.query(`UPDATE subscriptions SET client_id = $2 WHERE id = $1`, [sub.id, otherClientId]),
    /cannot be moved to another client/
  );

  const unchanged = await getSubscriptionAt(db, { orgId, clientId });
  assert.equal(Number(unchanged.price_cents), 9900, "nothing was written");
});

test("the status a row reports and the cancellation it carries cannot disagree", { skip: !HAS_DB }, async () => {
  await reset();
  await assert.rejects(
    () => db.query(
      `INSERT INTO subscriptions (org_id, client_id, tier, status) VALUES ($1,$2,'starter','cancelled')`,
      [orgId, clientId]
    ),
    /subscriptions_cancel_coherent/,
    "cancelled with no cancellation date"
  );
  await assert.rejects(
    () => db.query(
      `INSERT INTO subscriptions (org_id, client_id, tier, cancelled_at) VALUES ($1,$2,'starter',now())`,
      [orgId, clientId]
    ),
    /subscriptions_cancel_coherent/,
    "a cancellation date on a row that still reads active is the row a billing run would charge"
  );
});

test("cancelSubscription records when they asked, separately from when it ends", { skip: !HAS_DB }, async () => {
  await reset();
  await startSubscription(db, { orgId, clientId, tier: "starter", priceCents: 9900 });
  const cancelled = await cancelSubscription(db, { orgId, clientId });
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.cancelled_at);
  assert.ok(cancelled.effective_to,
    "a cancelled row must carry an end date — the overlap constraint reads dates, not status, "
    + "so an open-ended cancelled row locks the client out of ever signing up again");
  assert.deepEqual(cancelled.effective_to, cancelled.cancelled_at,
    "with no end date supplied, the row closes at the moment they asked");

  const again = await cancelSubscription(db, { orgId, clientId });
  assert.deepEqual(again.cancelled_at, cancelled.cancelled_at, "a retry must not move the date");
  assert.deepEqual(again.effective_to, cancelled.effective_to, "nor the date it ended");

  assert.equal(await cancelSubscription(db, { orgId, clientId: otherClientId }), null,
    "cancelling what does not exist returns nothing rather than inventing a row");
});

test("the date they asked and the date it ends stay separate when the end date is known",
  { skip: !HAS_DB }, async () => {
    await reset();
    const askedAt = new Date(Date.now() - 5 * 86_400_000);
    const endsAt = new Date(Date.now() + 25 * 86_400_000);
    await startSubscription(db, {
      orgId, clientId, tier: "starter", priceCents: 9900,
      at: new Date(Date.now() - 30 * 86_400_000).toISOString()
    });
    const cancelled = await cancelSubscription(db, {
      orgId, clientId, at: askedAt.toISOString(), endsAt: endsAt.toISOString()
    });
    assert.equal(new Date(cancelled.cancelled_at).getTime(), askedAt.getTime(),
      "cancelled_at is when they asked");
    assert.equal(new Date(cancelled.effective_to).getTime(), endsAt.getTime(),
      "effective_to is when it stops applying — they paid to the end of the period");
    assert.notDeepEqual(cancelled.cancelled_at, cancelled.effective_to,
      "the two dates are not the same fact and a dispute turns on the difference");
  });

// M16. A client cancels, then comes back. The row they cancelled has to be
// closed, or 075's exclusion constraint sees an open-ended date range and
// refuses every subscription that follows it — for good, with a raw constraint
// name rather than anything a person could act on.
test("a client who cancels can sign up again", { skip: !HAS_DB }, async () => {
  await reset();
  const first = await startSubscription(db, {
    orgId, clientId, tier: "starter", priceCents: 9900,
    at: new Date(Date.now() - 86_400_000).toISOString()
  });
  await cancelSubscription(db, { orgId, clientId });

  const second = await startSubscription(db, { orgId, clientId, tier: "pro", priceCents: 19900 });
  assert.notEqual(second.id, first.id, "coming back opens a new row");
  assert.equal(second.status, "active");
  assert.equal(second.effective_to, null, "the new one is the live one");

  const live = await getSubscriptionAt(db, { orgId, clientId });
  assert.equal(live.id, second.id, "and it is what a reader now sees");

  const history = await listSubscriptions(db, { orgId, clientId });
  assert.equal(history.length, 2, "the cancelled version survives as history");
  const closed = history.find((r) => r.id === first.id);
  assert.equal(closed.status, "cancelled");
  assert.ok(closed.effective_to, "closed, so it no longer covers the new one's dates");
});

test("a genuine double-booking is refused in words, not a constraint name",
  { skip: !HAS_DB }, async () => {
    await reset();
    await startSubscription(db, { orgId, clientId, tier: "starter", priceCents: 9900 });
    await assert.rejects(
      () => startSubscription(db, { orgId, clientId, tier: "pro", priceCents: 19900 }),
      (err) => {
        assert.doesNotMatch(err.message, /subscriptions_no_overlap/,
          "a Postgres constraint name is not something a person can act on");
        assert.match(err.message, /already has a subscription/);
        return true;
      },
      "the second live subscription is still refused — just readably"
    );
  });

// m11. changeTier reads the live version, then closes it and opens the successor
// in one statement. If that live version is closed by SOMEBODY ELSE in the gap
// between the read and the write, the statement updates no rows, so it inserts
// no rows either, and the call ends in a branch no test had ever executed.
//
// Reaching it by running two real calls at the same time is a coin toss, so the
// second writer is landed EXACTLY in the gap instead: the handle below is shaped
// like the one src/db.mjs exports (`{ query }`, nothing else) and cancels the
// subscription on the way into the plan-change statement. That is a real
// sequence — a closer cancelling a client while a manager upgrades them — held
// still so it happens every run rather than one run in a thousand.
test("a plan change that loses a race says so in words, and says nothing was saved",
  { skip: !HAS_DB }, async () => {
    await reset();
    const first = await startSubscription(db, {
      orgId, clientId, tier: "starter", priceCents: 9900,
      at: new Date(Date.now() - 86_400_000).toISOString()
    });

    let raced = false;
    const somebodyElseGetsThereFirst = {
      query: async (sql, params) => {
        if (!raced && /WITH closed AS/.test(sql)) {
          raced = true;
          await cancelSubscription(db, { orgId, clientId });
        }
        return db.query(sql, params);
      }
    };

    await assert.rejects(
      () => changeTier(somebodyElseGetsThereFirst, { orgId, clientId, tier: "pro", priceCents: 19900 }),
      (err) => {
        assert.ok(raced, "the second writer must actually have landed in the gap");
        assert.ok(err instanceof SubscriptionConflictError,
          "a caller has to be able to tell 'someone else edited this' from 'the server broke'");
        assert.equal(err.status, 409,
          "409 is the answer an endpoint should give; a plain Error becomes a 500 at "
          + "netlify/functions/api.mjs:334, which blames the server for a human collision");
        assert.match(err.message, /somebody else changed this subscription/);
        assert.doesNotMatch(err.message, /subscriptions_|SQLSTATE|23P01/,
          "no constraint names — this sentence is read by a person");
        return true;
      }
    );

    const history = await listSubscriptions(db, { orgId, clientId });
    assert.equal(history.length, 1, "no successor row was opened — nothing is half-applied");
    assert.equal(history[0].id, first.id);
    assert.equal(history[0].tier, "starter", "and the tier the client is on did not move");
    assert.equal(history[0].status, "cancelled", "what actually happened is the cancellation");
    assert.equal(await getSubscriptionAt(db, { orgId, clientId }), null,
      "there is no live version, which is why the change had nothing to change");

    // And the caller can act on it: re-reading shows the cancellation, and the
    // client can be signed up again. The error is a fork in the road, not a wall.
    const resumed = await startSubscription(db, { orgId, clientId, tier: "pro", priceCents: 19900 });
    assert.equal(resumed.status, "active");
    assert.equal(resumed.effective_to, null);
  });

test("the period window must be a real window or absent entirely", { skip: !HAS_DB }, async () => {
  await reset();
  await assert.rejects(
    () => db.query(
      `INSERT INTO subscriptions (org_id, client_id, tier, current_period_start, current_period_end)
       VALUES ($1,$2,'starter', now(), now() - interval '1 day')`,
      [orgId, clientId]
    ),
    /subscriptions_period/
  );
  await assert.rejects(
    () => db.query(
      `INSERT INTO subscriptions (org_id, client_id, tier, current_period_start) VALUES ($1,$2,'starter', now())`,
      [orgId, clientId]
    ),
    /subscriptions_period/,
    "half a window is not a window"
  );
});

// ---------------------------------------------------------------------------
// the card and the subscription together
// ---------------------------------------------------------------------------

test("a subscription physically cannot point at another client's card", { skip: !HAS_DB }, async () => {
  await reset();
  const theirCard = await putClientCard(db, { orgId, clientId: otherClientId, providerToken: "tok_theirs" });
  await assert.rejects(
    () => db.query(
      `INSERT INTO subscriptions (org_id, client_id, tier, card_id) VALUES ($1,$2,'starter',$3)`,
      [orgId, clientId, theirCard.id]
    ),
    /subscriptions_card_fk/,
    "charging the wrong client's card is not something to leave to a code review"
  );
});

test("attachCard moves the instrument without opening a version, and refuses a removed one", { skip: !HAS_DB }, async () => {
  await reset();
  const sub = await startSubscription(db, { orgId, clientId, tier: "starter", priceCents: 9900 });
  const card = await putClientCard(db, { orgId, clientId, providerToken: "tok_attach", last4: "9999" });

  const attached = await attachCard(db, { orgId, clientId, cardId: card.id });
  assert.equal(attached.id, sub.id, "replacing an expired card is not a plan change");
  assert.equal(attached.card_id, card.id);
  assert.equal((await listSubscriptions(db, { orgId, clientId })).length, 1, "no version was opened");

  await removeClientCard(db, { orgId, id: card.id });
  await assert.rejects(
    () => attachCard(db, { orgId, clientId, cardId: card.id }),
    /removed or belongs to another client/
  );

  const theirCard = await putClientCard(db, { orgId, clientId: otherClientId, providerToken: "tok_theirs_2" });
  await assert.rejects(
    () => attachCard(db, { orgId, clientId, cardId: theirCard.id }),
    /removed or belongs to another client/
  );
});

test("a card that paid for something cannot be deleted out from under it", { skip: !HAS_DB }, async () => {
  await reset();
  const card = await putClientCard(db, { orgId, clientId, providerToken: "tok_restrict" });
  await startSubscription(db, { orgId, clientId, tier: "starter", priceCents: 9900, cardId: card.id });
  await assert.rejects(
    () => db.query(`DELETE FROM client_cards WHERE id = $1`, [card.id]),
    /subscriptions_card_fk/,
    "cards are retired with removed_at; a DELETE would leave a charge nobody can explain"
  );
});

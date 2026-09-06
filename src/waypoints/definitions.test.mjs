// Turning the catalog into one client's checklist. No database.
//
// Everything here is about the two decisions that can hurt a real person: what
// number goes on a paydown, and what gets left off the list entirely.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  renderCopy,
  slugify,
  dollarsToCents,
  formatCents,
  revolvingAccounts,
  mergeByCreditor,
  dueAtFrom,
  stateClause,
  expandDefinitions,
  PAYDOWN_TARGET_FRACTION
} from "./definitions.mjs";

const CATALOG = Object.freeze([
  {
    key: "paydown_revolving_account",
    expands: "per_revolving_account",
    title: "Pay {creditor} down to {target}",
    detail: "This is the biggest lever on your score.",
    position: 10,
    owner_kind: "client",
    due_offset_days: 30,
    verify_kind: "paydown",
    paid_alternative_price_cents: null,
    paid_alternative_label: null,
    paid_alternative_kind: null,
    active: true
  },
  {
    key: "no_new_credit",
    expands: "once",
    title: "Do not open new credit until your funding is secured",
    detail: "A new card lowers your average account age.",
    position: 20,
    owner_kind: "client",
    due_offset_days: null,
    verify_kind: "no_new_credit",
    paid_alternative_price_cents: null,
    paid_alternative_label: null,
    paid_alternative_kind: null,
    active: true
  },
  {
    key: "form_llc",
    expands: "once",
    title: "File your LLC",
    detail: "File online with the Secretary of State{state_clause}. Once it is filed the clock starts.",
    position: 40,
    owner_kind: "client",
    due_offset_days: 30,
    verify_kind: null,
    paid_alternative_price_cents: null,
    paid_alternative_label: null,
    paid_alternative_kind: null,
    active: true
  }
]);

// A tri-merge: the same three cards reported once by each bureau, which is
// exactly what every simulator profile produces and what a real file looks like.
function triMerge(cards) {
  const rows = [];
  for (const bureau of ["TransUnion", "Experian", "Equifax"]) {
    for (const c of cards) {
      rows.push([c.creditor, bureau, c.balance, c.limit, "", "", c.status || "MONITOR"]);
    }
  }
  return rows;
}

describe("copy tokens", () => {
  test("a token with no value leaves a sentence that still reads", () => {
    const t = "File online with the Secretary of State{state_clause}. Once it is filed the clock starts.";
    assert.equal(
      renderCopy(t, { state_clause: stateClause("Texas") }),
      "File online with the Secretary of State in Texas. Once it is filed the clock starts."
    );
    assert.equal(
      renderCopy(t, { state_clause: stateClause("") }),
      "File online with the Secretary of State. Once it is filed the clock starts."
    );
  });

  test("a missing token never prints the word null or the token itself", () => {
    const out = renderCopy("Pay {creditor} down to {target}", {});
    assert.equal(out, "Pay down to");
    assert.ok(!/null|undefined|\{/.test(out));
  });

  test("stateClause carries its own connector so the sentence works either way", () => {
    assert.equal(stateClause("TX"), " in TX");
    assert.equal(stateClause(null), "");
    assert.equal(stateClause("   "), "");
  });
});

describe("keys and money", () => {
  test("a creditor name becomes something the key CHECK accepts", () => {
    assert.equal(slugify("Synchrony Bank / Care Credit"), "synchrony_bank_care_credit");
    assert.equal(slugify("Capital One Platinum"), "capital_one_platinum");
    assert.match(`paydown_${slugify("AMEX!!!")}`, /^[a-z0-9_]{2,64}$/);
  });

  test("a creditor name with nothing usable in it gives no key at all", () => {
    assert.equal(slugify("***"), "");
    assert.equal(slugify(null), "");
  });

  test("dollars become integer cents, and unknown stays unknown", () => {
    assert.equal(dollarsToCents(2870), 287000);
    assert.equal(dollarsToCents("1,"), null);
    // toCents() maps null and "" to 0 because it is written for payments. Here
    // zero and unknown are different answers and unknown must survive.
    assert.equal(dollarsToCents(null), null);
    assert.equal(dollarsToCents(""), null);
    assert.equal(dollarsToCents(undefined), null);
    assert.equal(dollarsToCents(0), 0);
  });

  test("a target reads as whole dollars", () => {
    assert.equal(formatCents(120000), "$1,200");
    assert.equal(formatCents(30000), "$300");
    assert.equal(formatCents(null), null);
  });
});

describe("reading the revolving accounts off a credit file", () => {
  test("the target is 10% of the LIMIT and is never derived from the balance", () => {
    const [a] = revolvingAccounts([["Capital One Platinum", "Experian", 2870, 3000, "96%", "", "CRITICAL"]]);
    assert.equal(PAYDOWN_TARGET_FRACTION, 0.1);
    assert.equal(a.limitCents, 300000);
    assert.equal(a.targetCents, 30000);
    assert.equal(a.balanceCents, 287000);
    assert.equal(a.payable, true);
  });

  test("no reported limit means NO TARGET and no paydown — not a target of zero", () => {
    const [a] = revolvingAccounts([["Some Card", "Experian", 1200, null, "", "", "MONITOR"]]);
    assert.equal(a.limitCents, null);
    assert.equal(a.targetCents, null);
    assert.equal(a.payable, false);
  });

  test("no reported balance means no paydown — we cannot check what we cannot see", () => {
    const [a] = revolvingAccounts([["Some Card", "Experian", null, 5000, "", "", "MONITOR"]]);
    assert.equal(a.targetCents, 50000);
    assert.equal(a.balanceCents, null);
    assert.equal(a.payable, false);
  });
});

describe("one card, one waypoint", () => {
  const cards = [
    { creditor: "Capital One Platinum", balance: 2870, limit: 3000, status: "CRITICAL" },
    { creditor: "Credit One Bank", balance: 1490, limit: 1500, status: "CRITICAL" }
  ];

  test("six bureau rows for two cards merge into two accounts", () => {
    const rows = revolvingAccounts(triMerge(cards));
    assert.equal(rows.length, 6);
    const merged = mergeByCreditor(rows);
    assert.equal(merged.length, 2);
    assert.deepEqual(merged.map((m) => m.creditorKey), ["capital_one_platinum", "credit_one_bank"]);
    assert.deepEqual(merged[0].bureaus, ["Equifax", "Experian", "TransUnion"]);
  });

  test("bureaus that disagree merge the CONSERVATIVE way: worst balance, lowest limit", () => {
    const merged = mergeByCreditor(revolvingAccounts([
      ["Chase", "Experian", 900, 5000, "", "", "MONITOR"],
      ["Chase", "Equifax", 1400, 4000, "", "", "MONITOR"]
    ]));
    assert.equal(merged.length, 1);
    assert.equal(merged[0].balanceCents, 140000, "the highest balance any bureau reports");
    assert.equal(merged[0].limitCents, 400000, "the lowest limit any bureau reports");
    assert.equal(merged[0].targetCents, 40000);
  });

  test("closed on every bureau is closed; open on one is still open", () => {
    const allClosed = mergeByCreditor(revolvingAccounts([
      ["Old Card", "Experian", 500, 2000, "", "", "CLOSED"],
      ["Old Card", "Equifax", 500, 2000, "", "", "CLOSED"]
    ]));
    assert.equal(allClosed[0].payable, false);

    const oneOpen = mergeByCreditor(revolvingAccounts([
      ["Old Card", "Experian", 500, 2000, "", "", "CLOSED"],
      ["Old Card", "Equifax", 500, 2000, "", "", "MONITOR"]
    ]));
    assert.equal(oneOpen[0].payable, true);
  });
});

describe("due dates", () => {
  const base = new Date("2026-09-06T12:00:00.000Z");

  test("an offset counts forward from enrolment", () => {
    assert.equal(dueAtFrom(base, 30).toISOString(), "2026-10-06T12:00:00.000Z");
    assert.equal(dueAtFrom(base, 0).toISOString(), "2026-09-06T12:00:00.000Z");
  });

  test("NO OFFSET MEANS NO DEADLINE, and that is a real answer", () => {
    assert.equal(dueAtFrom(base, null), null);
    assert.equal(dueAtFrom(base, undefined), null);
  });
});

describe("expanding the catalog for one client", () => {
  const enrolledAt = new Date("2026-09-06T12:00:00.000Z");
  const accounts = mergeByCreditor(revolvingAccounts(triMerge([
    { creditor: "Capital One Platinum", balance: 2870, limit: 3000, status: "CRITICAL" },
    { creditor: "Credit One Bank", balance: 1490, limit: 1500, status: "CRITICAL" }
  ])));

  test("three definitions and two cards make four waypoints, not eight", () => {
    const { waypoints } = expandDefinitions({
      definitions: CATALOG, accounts, state: "TX", enrolledAt, hasCreditFile: true
    });
    assert.deepEqual(waypoints.map((w) => w.key).sort(), [
      "form_llc", "no_new_credit", "paydown_capital_one_platinum", "paydown_credit_one_bank"
    ]);
  });

  test("the paydown carries the creditor, the target in cents, and a title a person can read", () => {
    const { waypoints } = expandDefinitions({
      definitions: CATALOG, accounts, state: "TX", enrolledAt, hasCreditFile: true
    });
    const w = waypoints.find((x) => x.key === "paydown_capital_one_platinum");
    assert.equal(w.title, "Pay Capital One Platinum down to $300");
    assert.equal(w.params.target_cents, 30000);
    assert.equal(w.params.balance_at_seed_cents, 287000);
    assert.deepEqual(w.params.bureaus, ["Equifax", "Experian", "TransUnion"]);
    assert.equal(w.verifyKind, "paydown");
    assert.equal(w.ownerKind, "client");
    assert.equal(w.dueAt.toISOString(), "2026-10-06T12:00:00.000Z");
  });

  test("a card already at or under its target gets no waypoint", () => {
    const paid = mergeByCreditor(revolvingAccounts(triMerge([
      { creditor: "Paid Off Card", balance: 100, limit: 5000, status: "MONITOR" }
    ])));
    const { waypoints, skipped } = expandDefinitions({
      definitions: CATALOG, accounts: paid, state: "TX", enrolledAt, hasCreditFile: true
    });
    assert.equal(waypoints.filter((w) => w.verifyKind === "paydown").length, 0);
    assert.equal(skipped.find((s) => s.accountKey === "paid_off_card").reason, "already_at_target");
  });

  test("no credit file: the personal tasks still seed and NO paydown is invented", () => {
    const { waypoints } = expandDefinitions({
      definitions: CATALOG, accounts: [], state: "", enrolledAt, hasCreditFile: false
    });
    assert.deepEqual(waypoints.map((w) => w.key).sort(), ["form_llc", "no_new_credit"]);
    assert.equal(
      waypoints.find((w) => w.key === "form_llc").detail,
      "File online with the Secretary of State. Once it is filed the clock starts."
    );
  });

  test("NO CREDIT FILE LEAVES THE NO-NEW-CREDIT BASELINE NULL, not an empty list", () => {
    // The difference matters: [] would later read every card the client has
    // ever had as newly opened, and put a real client in breach of a rule they
    // kept.
    const none = expandDefinitions({
      definitions: CATALOG, accounts: [], state: "", enrolledAt, hasCreditFile: false
    }).waypoints.find((w) => w.key === "no_new_credit");
    assert.equal(none.params.accounts_at_seed, null);
    assert.equal(none.params.snapshot_source, "none");

    const some = expandDefinitions({
      definitions: CATALOG, accounts, state: "TX", enrolledAt, hasCreditFile: true
    }).waypoints.find((w) => w.key === "no_new_credit");
    assert.deepEqual(some.params.accounts_at_seed, ["capital_one_platinum", "credit_one_bank"]);
    assert.equal(some.params.snapshot_source, "crs_result");
  });

  test("the no-new-credit row carries no deadline, so it can never read as overdue", () => {
    const w = expandDefinitions({
      definitions: CATALOG, accounts, state: "TX", enrolledAt, hasCreditFile: true
    }).waypoints.find((x) => x.key === "no_new_credit");
    assert.equal(w.dueAt, null);
  });

  test("an existing paydown row is reused by ACCOUNT, so a re-seed updates it", () => {
    const { waypoints } = expandDefinitions({
      definitions: CATALOG,
      accounts,
      state: "TX",
      enrolledAt: new Date("2026-11-01T00:00:00.000Z"),
      hasCreditFile: true,
      existingPaydownKeys: new Map([["capital_one_platinum", "paydown_capital_one_platinum"]]),
      existingDueAt: new Map([["paydown_capital_one_platinum", new Date("2026-10-06T12:00:00.000Z")]])
    });
    const w = waypoints.find((x) => x.key === "paydown_capital_one_platinum");
    assert.equal(
      w.dueAt.toISOString(), "2026-10-06T12:00:00.000Z",
      "a re-seed keeps the deadline the client was given, it does not push it forward"
    );
  });

  test("expansion is deterministic — two runs give byte-identical keys in one order", () => {
    const a = expandDefinitions({ definitions: CATALOG, accounts, state: "TX", enrolledAt, hasCreditFile: true });
    const b = expandDefinitions({ definitions: CATALOG, accounts, state: "TX", enrolledAt, hasCreditFile: true });
    assert.deepEqual(a.waypoints.map((w) => w.key), b.waypoints.map((w) => w.key));
  });

  test("every seeded waypoint has NO paid alternative, and a price of zero is never produced", () => {
    const { waypoints } = expandDefinitions({
      definitions: CATALOG, accounts, state: "TX", enrolledAt, hasCreditFile: true
    });
    for (const w of waypoints) {
      assert.equal(w.paidAlternativePriceCents, null);
      assert.equal(w.paidAlternativeLabel, null);
    }
  });

  test("a priced definition carries its price through in integer cents", () => {
    const priced = [{
      ...CATALOG[2],
      paid_alternative_price_cents: 10000,
      paid_alternative_label: "Have us do it",
      paid_alternative_kind: "llc_filing"
    }];
    const { waypoints } = expandDefinitions({
      definitions: priced, accounts: [], state: "TX", enrolledAt, hasCreditFile: true
    });
    assert.equal(waypoints[0].paidAlternativePriceCents, 10000);
    assert.equal(waypoints[0].paidAlternativeKind, "llc_filing");
  });
});

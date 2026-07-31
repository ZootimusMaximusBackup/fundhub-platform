// Unit tests for the banking surface.
//
// Most of these exist for ONE rule: unknown is not personal. It is the rule
// migration 082 was written to enforce in storage, and it is the rule easiest to
// lose on the way back out — `personal = not business` is a single plausible
// line that silently attributes somebody else's account to the client.
//
// So the tests below attack that from every direction I could find: the default,
// an unrecognised value, an empty string, a case difference, the group totals,
// and the deliberate absence of any combined figure.
//
// Pure module, so no database and no browser.

import { test, describe } from "node:test";
import assert from "node:assert";
import { bankingSurface, readEntityKind, ENTITY_KINDS } from "./banking-surface.mjs";

/* A stored bank_accounts row as Postgres hands it back: bigint columns arrive as
   STRINGS. Using the real wire types is the point — "1000" + "500" is "1000500". */
const acct = (over = {}) => ({
  id: "b1", name: "Everyday Checking", official_name: null, mask: "4321",
  account_type: "depository", account_subtype: "checking",
  entity_kind: "personal", entity_kind_source: "client_stated",
  entity_kind_set_at: new Date(),
  available_balance_cents: "150000", current_balance_cents: "150000",
  balance_as_of: new Date(), closed_at: null, ...over
});

const group = (s, key) => s.groups.find((g) => g.key === key);

describe("shape", () => {
  test("all three groups are always present, in reading order", () => {
    const s = bankingSurface([]);
    assert.deepEqual(s.groups.map((g) => g.key), ["personal", "business", "unknown"]);
    assert.deepEqual(ENTITY_KINDS, ["personal", "business", "unknown"]);
  });

  test("an always-present group means an empty group is never mistaken for a missing one", () => {
    const s = bankingSurface([acct()]);
    assert.equal(group(s, "business").count, 0);
    assert.equal(group(s, "business").available.value, null);
  });

  test("the response names its own source", () => {
    assert.equal(bankingSurface([]).source, "bank_accounts");
  });

  test("bad input does not throw", () => {
    for (const input of [undefined, null, [], "nonsense", 7, {}, [null, undefined, 3]]) {
      const s = bankingSurface(input);
      assert.equal(s.groups.length, 3, `input ${JSON.stringify(input)} lost a group`);
    }
  });
});

// ── THE RULE ────────────────────────────────────────────────────────────────

describe("unknown is not personal", () => {
  test("an account with no entity_kind lands in unclassified, NOT personal", () => {
    const s = bankingSurface([acct({ entity_kind: undefined, entity_kind_source: null })]);
    assert.equal(group(s, "personal").count, 0,
      "an unclassified account was counted as the client's own money");
    assert.equal(group(s, "unknown").count, 1);
  });

  test("an explicit 'unknown' stays unclassified", () => {
    const s = bankingSurface([acct({ entity_kind: "unknown", entity_kind_source: null })]);
    assert.equal(group(s, "personal").count, 0);
    assert.equal(group(s, "unknown").count, 1);
  });

  test("an unrecognised value becomes unclassified, never personal", () => {
    // 082's CHECK should make these impossible, but this module also reads rows
    // from databases older than the constraint. The safe direction is not
    // symmetric: mis-filing a personal account as unclassified costs a click;
    // mis-filing anything else as personal is a false statement about whose
    // money it is.
    for (const v of ["", "   ", "mixed", "trust", "joint", "PERSONAL_ISH", null, 7, {}, []]) {
      const s = bankingSurface([acct({ entity_kind: v, entity_kind_source: null })]);
      assert.equal(group(s, "personal").count, 0,
        `entity_kind ${JSON.stringify(v)} was filed as personal`);
      assert.equal(group(s, "unknown").count, 1,
        `entity_kind ${JSON.stringify(v)} did not land in unclassified`);
    }
  });

  test("a business account is never folded into personal either", () => {
    const s = bankingSurface([acct({ entity_kind: "business", entity_kind_source: "document_verified" })]);
    assert.equal(group(s, "personal").count, 0);
    assert.equal(group(s, "business").count, 1);
  });

  test("case and whitespace do not change whose money it is", () => {
    for (const v of ["PERSONAL", " personal ", "Personal"]) {
      assert.equal(readEntityKind(v), "personal", `${JSON.stringify(v)} did not read as personal`);
    }
    for (const v of ["BUSINESS", " business "]) {
      assert.equal(readEntityKind(v), "business");
    }
  });

  test("unclassified money is never added to the personal total", () => {
    // The arithmetic version of the same rule, and the one a screen would
    // actually show. $1,500 personal and $9,000 unclassified must not read as
    // $10,500 of the client's money.
    const s = bankingSurface([
      acct({ id: "a", entity_kind: "personal", current_balance_cents: "150000" }),
      acct({ id: "b", entity_kind: "unknown", entity_kind_source: null, current_balance_cents: "900000" })
    ]);
    assert.equal(group(s, "personal").current.value, 150000,
      "unclassified money leaked into the personal total");
    assert.equal(group(s, "unknown").current.value, 900000);
  });

  test("there is NO combined balance anywhere in the response", () => {
    // A single "total cash" figure is the same defect wearing a friendlier face:
    // a reader takes it as the client's money, and for two of the three groups
    // that is not established. Its absence is the feature.
    const s = bankingSurface([
      acct({ id: "a", entity_kind: "personal", current_balance_cents: "150000" }),
      acct({ id: "b", entity_kind: "business", entity_kind_source: "staff_reviewed", current_balance_cents: "500000" }),
      acct({ id: "c", entity_kind: "unknown", entity_kind_source: null, current_balance_cents: "900000" })
    ]);
    const top = Object.keys(s);
    for (const k of ["total", "total_cents", "balance", "current", "available", "combined"]) {
      assert.ok(!top.includes(k), `the response exposes a combined figure: ${k}`);
    }
    const combined = 150000 + 500000 + 900000;
    assert.ok(!JSON.stringify(s).includes(String(combined)),
      "a figure equal to the sum across all three groups appears in the response");
  });

  test("the unclassified pile is counted and flagged for action", () => {
    const s = bankingSurface([
      acct({ id: "a", entity_kind: "personal" }),
      acct({ id: "b", entity_kind: "unknown", entity_kind_source: null }),
      acct({ id: "c", entity_kind: undefined, entity_kind_source: null })
    ]);
    assert.equal(s.unclassified, 2);
    assert.equal(s.needs_classification, true);
  });

  test("nothing unclassified means nothing to act on", () => {
    const s = bankingSurface([acct({ entity_kind: "personal" })]);
    assert.equal(s.unclassified, 0);
    assert.equal(s.needs_classification, false);
  });
});

// ── NULL and partial totals ────────────────────────────────────────────────

describe("NULL means unknown and never renders as zero", () => {
  test("a client with no accounts reads as unknown, not as $0.00", () => {
    const s = bankingSurface([]);
    for (const key of ENTITY_KINDS) {
      assert.equal(group(s, key).current.value, null, `${key} current was not null`);
      assert.equal(group(s, key).current.display, null, `${key} rendered a figure for an empty set`);
      assert.equal(group(s, key).available.display, null);
    }
    assert.equal(s.accounts, 0);
  });

  test("a bank that did not report an available balance makes the group total a floor", () => {
    const s = bankingSurface([
      acct({ id: "a", available_balance_cents: "150000" }),
      acct({ id: "b", available_balance_cents: null })
    ]);
    const g = group(s, "personal");
    assert.equal(g.available.value, 150000, "the known balance was dropped instead of counted");
    assert.equal(g.available.basis.counted, 1);
    assert.equal(g.available.basis.unknown, 1);
    assert.equal(g.available.basis.partial, true,
      "a total over a data set with a hole in it was presented as complete");
  });

  test("nothing is flagged partial when nothing is missing", () => {
    const s = bankingSurface([acct({ id: "a" }), acct({ id: "b" })]);
    const g = group(s, "personal");
    assert.equal(g.available.basis.partial, false);
    assert.equal(g.current.basis.partial, false);
  });

  test("bigint columns arriving as strings are added, not concatenated", () => {
    const s = bankingSurface([
      acct({ id: "a", current_balance_cents: "150000" }),
      acct({ id: "b", current_balance_cents: "50000" })
    ]);
    assert.equal(group(s, "personal").current.value, 200000);
  });

  test("an unparseable balance is unknown rather than NaN", () => {
    const s = bankingSurface([acct({ current_balance_cents: "not a number" })]);
    assert.equal(group(s, "personal").current.value, null);
    assert.equal(group(s, "personal").current.basis.unknown, 1);
  });
});

// ── overdrafts and closed accounts ─────────────────────────────────────────

describe("overdrafts and closed accounts", () => {
  test("a negative balance is NOT clamped — an overdraft is the thing to see", () => {
    // os-grid clamps credit headroom at zero because an over-limit card offers
    // no room to draw. Cash is the opposite: hiding an overdrawn account hides
    // exactly the account somebody needs to look at.
    const s = bankingSurface([acct({ current_balance_cents: "-42000" })]);
    assert.equal(group(s, "personal").current.value, -42000);
    assert.equal(group(s, "personal").current.display, "-420.00");
    assert.equal(group(s, "personal").accounts[0].overdrawn, true);
  });

  test("an overdraft reduces the group total rather than being dropped", () => {
    const s = bankingSurface([
      acct({ id: "a", current_balance_cents: "150000" }),
      acct({ id: "b", current_balance_cents: "-50000" })
    ]);
    assert.equal(group(s, "personal").current.value, 100000);
  });

  test("a positive balance is not marked overdrawn, and an unknown one is not either", () => {
    assert.equal(bankingSurface([acct({ current_balance_cents: "1" })]).groups[0].accounts[0].overdrawn, false);
    assert.equal(bankingSurface([acct({ current_balance_cents: null })]).groups[0].accounts[0].overdrawn, false);
  });

  test("a closed account is still counted but its balance is not reachable money", () => {
    const s = bankingSurface([
      acct({ id: "a", current_balance_cents: "150000" }),
      acct({ id: "b", closed_at: new Date(), current_balance_cents: "999999" })
    ]);
    assert.equal(s.accounts, 2);
    assert.equal(s.open_accounts, 1);
    assert.equal(s.closed_accounts, 1);
    assert.equal(group(s, "personal").count, 2, "a closed account vanished from the list");
    assert.equal(group(s, "personal").current.value, 150000,
      "a closed account's last known balance was counted as available money");
  });
});

// ── provenance ─────────────────────────────────────────────────────────────

describe("how we know", () => {
  test("the basis for a classification is carried through, not just the label", () => {
    const s = bankingSurface([acct({ entity_kind: "business", entity_kind_source: "document_verified" })]);
    assert.equal(group(s, "business").accounts[0].entity_kind_source, "document_verified");
  });

  test("an unclassified account has no source, and that is not an error", () => {
    const s = bankingSurface([acct({ entity_kind: "unknown", entity_kind_source: null })]);
    assert.equal(group(s, "unknown").accounts[0].entity_kind_source, null);
  });

  test("no full account number is carried — only the stored mask", () => {
    const s = bankingSurface([acct({ mask: "4321" })]);
    const view = group(s, "personal").accounts[0];
    assert.equal(view.mask, "4321");
    for (const k of Object.keys(view)) {
      assert.ok(!/account_number|routing|iban/i.test(k), `the view exposes ${k}`);
    }
  });
});

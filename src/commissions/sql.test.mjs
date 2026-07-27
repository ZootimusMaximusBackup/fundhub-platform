import { test } from "node:test";
import assert from "node:assert";
import {
  LEDGER_INSERT_COLUMNS, ledgerInsertParams, SQL_INSERT_LEDGER, SQL_RULES_IN_FORCE,
  SQL_LINK_ROUND_TO_SALE, SQL_SUPERSEDE_RULE
} from "./sql.mjs";
import { computeFrontEnd } from "./calculate.mjs";

const draft = () => computeFrontEnd({
  org_id: "org-1",
  sale: { id: "sale-1", org_id: "org-1", client_id: "client-1", product_id: "prod-1",
          agreed_price: "3000.00", currency: "USD" },
  product: { id: "prod-1", name: "Card Stacking DFY" },
  client: { id: "client-1", client_code: "FH-000042" },
  payments: [{ kind: "deposit", amount: "3000.00" }],
  attributions: [{ staff_id: "staff-1", employee_code: "EMP-000001", role: "closer",
                   basis: "front_end", split_percent: 100 }],
  rules: [{ id: "rule-1", name: "r", basis: "front_end", stacking: "base", calc_method: "flat",
            flat_amount: "500.00", amount_basis: "deposit_collected",
            effective_from: "2026-01-01T00:00:00Z", effective_to: null, active: true }],
  occurredAt: "2026-07-01T12:00:00Z",
  sourceEvent: "deposit.paid"
}).drafts[0];

test("the insert has exactly as many placeholders as it has columns", () => {
  const placeholders = new Set((SQL_INSERT_LEDGER.match(/\$\d+/g) || []));
  assert.equal(placeholders.size, LEDGER_INSERT_COLUMNS.length);
  for (let i = 1; i <= LEDGER_INSERT_COLUMNS.length; i++) {
    assert.ok(placeholders.has(`$${i}`), `missing placeholder $${i}`);
  }
});

test("ledgerInsertParams lines a draft up with the column order", () => {
  const params = ledgerInsertParams(draft());
  assert.equal(params.length, LEDGER_INSERT_COLUMNS.length);
  assert.equal(params[LEDGER_INSERT_COLUMNS.indexOf("amount")], "500.00");
  assert.equal(params[LEDGER_INSERT_COLUMNS.indexOf("basis")], "front_end");
  assert.equal(params[LEDGER_INSERT_COLUMNS.indexOf("client_code")], "FH-000042");
});

test("ledgerInsertParams serialises the rule snapshot for the jsonb column", () => {
  const params = ledgerInsertParams(draft());
  const snap = params[LEDGER_INSERT_COLUMNS.indexOf("rule_snapshot")];
  assert.equal(typeof snap, "string");
  assert.equal(JSON.parse(snap).calc_method, "flat");
});

test("ledgerInsertParams sends null, never undefined, for fields a draft omits", () => {
  const params = ledgerInsertParams(draft());
  assert.ok(!params.includes(undefined), "undefined would be a pg driver error");
  assert.equal(params[LEDGER_INSERT_COLUMNS.indexOf("reverses_ledger_id")], null);
});

test("every query is parameterised — no value is ever interpolated into SQL", () => {
  for (const [name, sql] of Object.entries({
    SQL_INSERT_LEDGER, SQL_RULES_IN_FORCE, SQL_LINK_ROUND_TO_SALE, SQL_SUPERSEDE_RULE
  })) {
    assert.ok(!sql.includes("${"), `${name} contains a template interpolation`);
    assert.match(sql, /\$\d+/, `${name} takes no parameters`);
  }
});

test("the insert is replay-safe: a redelivered event does nothing instead of paying twice", () => {
  assert.match(SQL_INSERT_LEDGER, /ON CONFLICT[\s\S]*DO NOTHING/);
});

test("superseding a rate closes the live row rather than editing the rate", () => {
  assert.match(SQL_SUPERSEDE_RULE, /SET effective_to/);
  assert.ok(!/SET[\s\S]*percent\s*=/.test(SQL_SUPERSEDE_RULE),
    "superseding must never overwrite the rate itself");
});

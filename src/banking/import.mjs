// Pull accounts from whichever banking provider is selected and write them down.
//
// This is the only thing that turns a provider response into rows. provider.mjs
// decides WHO answers; this decides WHERE the answer goes. Keeping them apart
// means the mock and a future real Plaid client share this entire file — the
// mapping, the upsert keys, the transaction handling — and going live does not
// re-implement any of it.
//
//
// *** SIGN CONVENTION — READ BEFORE WIRING A REAL PROVIDER. ***
//
// 085's own COMMENT ON TABLE says it: amount_cents NEGATIVE means money LEFT the
// account, and "Plaid's legacy convention is the OPPOSITE — ingest must negate at
// the boundary."
//
// src/banking/mock.mjs already emits this repo's convention, so there is NO
// negation on the mock path and none is wanted. WHOEVER WIRES REAL PLAID MUST ADD
// ONE, right here in toTransactionRow(), and must not assume the absence of a
// negation in this file means none is needed. Getting it wrong inverts every
// cash-flow number in the product and does so silently: the totals still add up,
// they are just backwards, and "your outgoings this month were +$4,200" reads as
// a good month.
//
//
// UPSERT, NEVER APPEND. Accounts key on (plaid_item_id, plaid_account_id) per
// 081's partial unique index; transactions key on (bank_account_id,
// provider_transaction_id) per 085's. Re-importing is therefore safe and
// idempotent, which it has to be — the owner will click refresh more than once,
// and a run that doubled his balances would be indistinguishable from a real
// change.
//
// entity_kind IS NEVER WRITTEN HERE. See the header of src/banking/accounts.mjs.
// A provider is not an authority on whose money an account holds, and every
// imported row stays at 081/082's 'unknown' default until a human says otherwise.

import { db as sharedDb, pool } from "../db.mjs";
import { getAccounts as providerGetAccounts, bankingProviderName } from "./provider.mjs";

async function withTransaction(db, fn) {
  const acquire = typeof db?.connect === "function"
    ? () => db.connect()
    : (db === sharedDb ? () => pool().connect() : null);
  if (!acquire) return fn(db);
  const client = await acquire();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export class BankImportError extends Error {
  constructor(message, { status = 400, reason = null } = {}) {
    super(message);
    this.name = "BankImportError";
    this.status = status;
    this.reason = reason;
  }
}

/* -------------------------------------------------------------------------- *
 * Mapping
 * -------------------------------------------------------------------------- */

const ACCOUNT_COLS = [
  "org_id", "client_id", "plaid_item_id", "plaid_account_id",
  "name", "official_name", "mask", "account_type", "account_subtype",
  "currency_code", "available_balance_cents", "current_balance_cents",
  "credit_limit_cents", "balance_as_of", "raw"
];

function toAccountRow(a, { orgId, clientId, itemRowId }) {
  return {
    org_id: orgId,
    client_id: clientId,
    plaid_item_id: itemRowId,
    plaid_account_id: a.provider_account_id ?? null,
    name: a.name ?? null,
    official_name: a.official_name ?? null,
    // The provider's mask is already a fragment, but it is run through the same
    // truncation as hand entry rather than trusted — a provider that started
    // returning full numbers must not be able to write one into this table.
    mask: a.mask === null || a.mask === undefined ? null : String(a.mask).replace(/\D/g, "").slice(-4) || null,
    account_type: a.account_type ?? null,
    account_subtype: a.account_subtype ?? null,
    currency_code: a.currency_code ?? null,
    available_balance_cents: a.available_balance_cents ?? null,
    current_balance_cents: a.current_balance_cents ?? null,
    credit_limit_cents: a.credit_limit_cents ?? null,
    balance_as_of: a.balance_as_of ?? null,
    // The account record verbatim, minus the bulky child collections which get
    // their own tables. Never contains a credential.
    raw: JSON.stringify({ ...a, transactions: undefined, holdings: undefined, statement_cycle: undefined })
  };
}

/** Transactions the ledger cannot accept, dropped and COUNTED rather than
 *  silently skipped — the same discipline replaceEvidence() applies to
 *  unidentified evidence ids. A provider sending unusable rows is worth knowing
 *  about, not discovering later from a short list. */
function partitionTransactions(txs) {
  const usable = [], dropped = [];
  for (const t of txs ?? []) {
    const amount = t.amount_cents;
    // 085 CHECKs amount_cents <> 0. A zero-amount transaction is a real thing at
    // some banks (an authorisation hold that resolved to nothing) and simply has
    // no place in a ledger whose whole purpose is summing movement.
    if (!Number.isInteger(amount) || amount === 0) { dropped.push({ t, why: "zero_or_non_integer_amount" }); continue; }
    // 085 CHECKs that a non-pending row has a posted_on.
    if (!t.pending && !t.posted_on) { dropped.push({ t, why: "settled_with_no_posted_date" }); continue; }
    if (!t.provider_transaction_id) { dropped.push({ t, why: "no_provider_transaction_id" }); continue; }
    usable.push(t);
  }
  return { usable, dropped };
}

/* -------------------------------------------------------------------------- *
 * The import
 * -------------------------------------------------------------------------- */

/**
 * ensureItem — find or create the plaid_items row this import hangs off.
 *
 * link_state goes to 'active' for a provider that actually answered. It is NOT
 * set to 'active' speculatively: the caller only reaches here after
 * getAccounts() returned ok.
 *
 * consent_granted_at IS LEFT ALONE. 080 has that column and every row has it
 * NULL; W2 owns filling it in and gating on it. Setting it here because an import
 * succeeded would be recording a consent nobody gave.
 */
async function ensureItem(tx, { orgId, clientId, providerName }) {
  const existing = await tx.query(
    `SELECT id FROM plaid_items
      WHERE org_id = $1 AND client_id = $2 AND plaid_item_id = $3`,
    [orgId, clientId, `${providerName}:${clientId}`]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const created = await tx.query(
    `INSERT INTO plaid_items
       (org_id, client_id, plaid_item_id, institution_name, link_state)
     VALUES ($1, $2, $3, $4, 'active')
     RETURNING id`,
    [orgId, clientId, `${providerName}:${clientId}`,
     providerName === "mock" ? "Mock Bank (test data)" : null]
  );
  return created.rows[0].id;
}

/**
 * importAccounts(db, { orgId, clientId, env }) → a per-table count of what landed.
 *
 * Everything in ONE transaction. An account and the statement cycle, holdings and
 * transactions underneath it are a single claim about a person's finances; half
 * of it landing produces a card with no due date, or a brokerage account whose
 * positions do not add up to its balance, and neither raises an error anywhere.
 *
 * THE INSTITUTION NAME SAYS "Mock Bank (test data)" ON THE MOCK PATH, ON PURPOSE.
 * The owner must be able to see, on the screen, that these numbers are invented.
 * A mock that is indistinguishable from real data is a trap, not a convenience.
 */
export async function importAccounts(db, { orgId, clientId, env = process.env, today = null } = {}) {
  if (!orgId) throw new BankImportError("orgId is required", { status: 400 });
  if (!clientId) throw new BankImportError("clientId is required", { status: 400 });

  const providerName = bankingProviderName(env);
  if (!providerName) {
    throw new BankImportError(
      "BANKING_PROVIDER is not set to a provider this build knows", { status: 503, reason: "unknown_provider" });
  }

  return withTransaction(db, async (tx) => {
    const itemRowId = await ensureItem(tx, { orgId, clientId, providerName });

    /* getAccounts is called with the plaid_items row id, so the mock's seed is
       that id — stable for the life of the row. Re-importing therefore produces
       byte-identical accounts and the upserts are no-ops on the second run,
       which is exactly the property that makes a refresh button safe. */
    const result = await providerGetAccounts({ itemId: itemRowId, env, today });
    if (!result.ok) {
      throw new BankImportError(
        `provider refused: ${result.reason}`,
        { status: result.reason === "not_implemented" ? 501 : 503, reason: result.reason });
    }

    const counts = { accounts: 0, statementCycles: 0, holdings: 0, transactions: 0, droppedTransactions: [] };

    for (const a of result.accounts) {
      const row = toAccountRow(a, { orgId, clientId, itemRowId });
      const updates = ACCOUNT_COLS
        .filter((c) => !["org_id", "client_id", "plaid_item_id", "plaid_account_id"].includes(c))
        .map((c) => `${c} = EXCLUDED.${c}`);

      /* THE `WHERE` ON THIS ON CONFLICT IS NOT OPTIONAL.
         `uq_bank_accounts_plaid` is a PARTIAL unique index — 081 declares it
         `WHERE plaid_item_id IS NOT NULL AND plaid_account_id IS NOT NULL`,
         because both columns are NULL on every hand-entered row and NULLs do not
         collide, so an unpartitioned index would block legitimate manual entry.

         Postgres will only match a partial index if the ON CONFLICT clause
         repeats its predicate. Without this line every import fails outright
         with "there is no unique or exclusion constraint matching the ON CONFLICT
         specification" — not on an edge case, on the FIRST row, every time.
         A stubbed test cannot catch it; only a real database can. */
      const saved = await tx.query(
        `INSERT INTO bank_accounts (${ACCOUNT_COLS.join(", ")})
         VALUES (${ACCOUNT_COLS.map((_, i) => `$${i + 1}`).join(", ")})
         ON CONFLICT (plaid_item_id, plaid_account_id)
           WHERE plaid_item_id IS NOT NULL AND plaid_account_id IS NOT NULL
         DO UPDATE SET ${updates.join(", ")}, updated_at = now()
         RETURNING id`,
        ACCOUNT_COLS.map((c) => row[c])
      );
      const accountId = saved.rows[0].id;
      counts.accounts++;

      if (a.statement_cycle) {
        const c = a.statement_cycle;
        await tx.query(
          `INSERT INTO account_statement_cycles
             (org_id, client_id, bank_account_id, statement_close_day, payment_due_day,
              last_statement_date, last_statement_balance_cents, minimum_payment_cents,
              apr, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'provider')
           ON CONFLICT (bank_account_id) DO UPDATE SET
             statement_close_day = EXCLUDED.statement_close_day,
             payment_due_day = EXCLUDED.payment_due_day,
             last_statement_date = EXCLUDED.last_statement_date,
             last_statement_balance_cents = EXCLUDED.last_statement_balance_cents,
             minimum_payment_cents = EXCLUDED.minimum_payment_cents,
             apr = EXCLUDED.apr, source = 'provider', updated_at = now()`,
          [orgId, clientId, accountId, c.statement_close_day, c.payment_due_day,
           c.last_statement_date, c.last_statement_balance_cents, c.minimum_payment_cents, c.apr]
        );
        counts.statementCycles++;
      }

      if (Array.isArray(a.holdings)) {
        // Replace, not merge — a portfolio read states what is held now. Same
        // call replaceHoldings() makes and for the same reason.
        await tx.query(`DELETE FROM investment_holdings WHERE bank_account_id = $1`, [accountId]);
        for (const h of a.holdings) {
          await tx.query(
            `INSERT INTO investment_holdings
               (org_id, client_id, bank_account_id, symbol, description, quantity,
                cost_basis_cents, current_value_cents, currency_code, as_of, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'provider')`,
            [orgId, clientId, accountId, String(h.symbol).toUpperCase(), h.description ?? null,
             h.quantity ?? null, h.cost_basis_cents ?? null, h.current_value_cents ?? null,
             h.currency_code ?? null, h.as_of ?? null]
          );
          counts.holdings++;
        }
      }

      const { usable, dropped } = partitionTransactions(a.transactions);
      for (const d of dropped) counts.droppedTransactions.push({ account: row.plaid_account_id, why: d.why });

      for (const t of usable) {
        await tx.query(
          `INSERT INTO bank_transactions
             (org_id, client_id, bank_account_id, amount_cents, posted_on,
              merchant_name, is_pending, provider_transaction_id, provider, raw)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (bank_account_id, provider_transaction_id)
           DO UPDATE SET amount_cents = EXCLUDED.amount_cents,
                         posted_on = EXCLUDED.posted_on,
                         merchant_name = EXCLUDED.merchant_name,
                         is_pending = EXCLUDED.is_pending,
                         updated_at = now()`,
          [orgId, clientId, accountId, t.amount_cents, t.posted_on ?? null,
           t.merchant_name ?? t.description ?? null, Boolean(t.pending),
           t.provider_transaction_id, providerName, JSON.stringify(t)]
        );
        counts.transactions++;
      }
    }

    return { ...counts, provider: providerName, itemId: itemRowId };
  });
}

export default { importAccounts, BankImportError };

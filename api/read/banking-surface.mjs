// GET /api/read/banking-surface?client_id=<uuid> — the banking screen's read.
//
// Accounts, card terms, detected bills and payment windows for one client. The
// bureau side (credit lines from a soft pull) is /api/read/finance-os and stays
// separate — see that file's header.
//
// *** COMPLIANCE: THIS ENDPOINT READS CONSUMER BANK DATA AND THE SOC 2 CONTROLS
// *** FOR IT ARE NOT IN PLACE. db/migrations/080_plaid_items.sql lists what is
// missing; the one that bites here is that there is NO ACCESS LOG for bank data
// equivalent to `pii_access_log`. Reading this endpoint leaves no audit trail of
// who looked at whose bank balances. That is a real gap, it is named rather than
// assumed away, and it should be closed before this is exposed beyond staff.
//
// Nothing here fetches from Plaid. There is no outbound network call anywhere in
// this repository; every row below is read from tables that a sync job — which
// does not exist yet — would populate. `plaidEnabled` tells the screen which of
// "nothing connected" and "the feature is off" it is looking at, because those
// need different words and only one of them is worth investigating.
//
// client_id IS REQUIRED, for the same reason as every other per-person financial
// read here: a paginated firehose of everybody's bank balances is not a screen
// anyone asked for.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, redact, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { isPlaidEnabled } from "../../src/banking/plaid.mjs";
import { listCurrentLiabilities } from "../../src/banking/liabilities.mjs";
import { paymentWindow } from "../../src/banking/cashflow.mjs";

/* The columns the screen needs, named rather than SELECT *: an access token
   lives one table over and a widening SELECT is how it would reach a browser. */
const ACCOUNT_COLUMNS = `
  a.id, a.name, a.official_name, a.mask, a.type, a.subtype,
  a.entity_kind, a.entity_kind_source,
  a.balance_current_cents, a.balance_available_cents, a.balance_limit_cents,
  a.balance_as_of, a.status`;

// THE ROLE GATE IS TWO CALLS, NOT ONE ARGUMENT — requireAuth's third parameter
// is { db, env } and a `roles` key there is silently dropped. See the same note
// in api/read/tradelines.mjs, which shipped that hole once.
export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const query = req.query || {};
  const clientId = query.client_id;
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }

  // `today` is a parameter, not a clock read, because every date decision below
  // flows into paymentWindow(), which is pure and takes the day it is planning
  // from. Defaulting here keeps the endpoint usable without one while leaving
  // the projection reproducible.
  const today = isIsoDate(query.today) ? query.today : new Date().toISOString().slice(0, 10);

  try {
    const client = (await db.query(
      `SELECT id, first_name, last_name, email FROM clients WHERE id = $1`, [clientId]
    )).rows[0];
    if (!client) return res.status(404).json({ ok: false, error: "no client with that id" });

    const accounts = (await db.query(
      `SELECT ${ACCOUNT_COLUMNS}
         FROM bank_accounts a
        WHERE a.client_id = $1 AND a.status = 'open'
        ORDER BY a.entity_kind, a.name NULLS LAST`,
      [clientId]
    )).rows;

    // The newest connection's health. A screen must be able to say "reconnect
    // your bank" rather than "something went wrong".
    const item = (await db.query(
      `SELECT status, last_synced_at FROM plaid_items
        WHERE client_id = $1 ORDER BY linked_at DESC LIMIT 1`,
      [clientId]
    )).rows[0] ?? null;

    const cards = await listCurrentLiabilities(db, { clientId });

    const bills = (await db.query(
      `SELECT id, merchant_name, amount_cents, amount_variance_cents, cadence,
              interval_days, confidence, occurrence_count, next_expected_date, source, status
         FROM recurring_bills
        WHERE client_id = $1 AND status = 'active'
        ORDER BY next_expected_date ASC NULLS LAST, confidence DESC`,
      [clientId]
    )).rows;

    // One payment window per card. The engine decides; this endpoint only feeds
    // it and passes its answer through untouched — including, and especially,
    // the refusals. A null window keeps its reason all the way to the screen.
    const windows = cards.map((c) => {
      const funding = fundingAccountFor(accounts);
      const result = paymentWindow({
        today,
        dueDate: c.next_payment_due_date,
        amountCents: c.minimum_payment_cents,
        balanceCents: funding?.balance_current_cents ?? null,
        balanceAsOf: funding?.balance_as_of ?? null,
        // Other cards' minimums in the same window are real competing
        // obligations. Detected bills are deliberately NOT included: they are
        // guesses (086), and a guess that closes somebody's payment window
        // would be a guess that changed their behaviour.
        outflows: cards
          .filter((o) => o.bank_account_id !== c.bank_account_id && o.next_payment_due_date && o.minimum_payment_cents)
          .map((o) => ({ date: iso(o.next_payment_due_date), amountCents: Number(o.minimum_payment_cents) }))
      });
      return { bankAccountId: c.bank_account_id, ...result };
    });

    return res.status(200).json({
      ok: true,
      client: redact(client),
      plaidEnabled: isPlaidEnabled(),
      itemStatus: item?.status ?? null,
      lastSyncedAt: item?.last_synced_at ?? null,
      today,
      accounts: redact(accounts),
      cards: redact(cards),
      bills: redact(bills),
      paymentWindows: windows
    });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e.code)) {
      return res.status(400).json({ ok: false, error: "bad request parameter" });
    }
    throw e;
  }
}

/* Which account a card payment would come out of. The largest depository
   balance, because that is where somebody actually pays a card from, and
   guessing "the first one" would put a projection against a savings account
   they never touch.
   Returns null when nothing qualifies, which paymentWindow() turns into a NO_BALANCE
   refusal with a reason — the correct outcome, rather than a window computed
   against an invented balance. */
function fundingAccountFor(accounts) {
  const candidates = accounts
    .filter((a) => a.type === "depository" && a.balance_current_cents != null);
  if (!candidates.length) return null;
  return candidates.reduce((best, a) =>
    Number(a.balance_current_cents) > Number(best.balance_current_cents) ? a : best);
}

function iso(v) {
  if (!v) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function isIsoDate(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

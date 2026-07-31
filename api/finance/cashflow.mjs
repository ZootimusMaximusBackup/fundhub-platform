// /api/finance/cashflow — the day-by-day projection, the payment window, and
// the three operator thresholds behind both.
//
//   GET  ?client_id=<uuid>[&horizon_days=]     → { ok, projection, window? }
//   GET  ?view=settings                        → { ok, thresholds, gaps }
//   POST { action: "save_settings", min_buffer_cents?, confidence_floor?,
//                                   settlement_lead_days?, sign_off? }
//
// *** SCAFFOLD STUB — TRACK 4 OWNS THIS FILE (with bills.mjs). ***
// Auth, role gate, org scoping, method switch and error mapping are finished and
// are the contract. Track 4 replaces the `not_implemented` bodies.
//
// *** THERE IS NO WRITER FOR cashflow_settings ANYWHERE IN src/. ***
// src/banking/settings.mjs is READ-ONLY: loadThresholds() reads one row and
// reshapes it, configGaps() reads a view. Both are deliberately thin and neither
// writes. So the `save_settings` action below has no module to call and Track 4
// writes the UPDATE in this file. Three rules it must not break, all of them
// stated at length in db/migrations/088_cashflow_settings.sql:
//
//   1. NULL MEANS UNSET, NOT ZERO. Clearing a threshold must return the system
//      to "nobody has decided this", not to "somebody decided zero".
//      loadThresholds() maps a NULL column to an ABSENT key precisely so the
//      model goes back to reporting it as a gap. An UPDATE that COALESCEs a
//      cleared value to 0 destroys that distinction permanently.
//   2. EACH VALUE CARRIES ITS OWN signed_off_at/by. A single row-level flag
//      would let signing off on the settlement lead silently bless a buffer
//      nobody looked at. Sign off one value at a time.
//   3. A BIGGER BUFFER IS NOT THE SAFE DIRECTION. min_buffer_cents is a floor
//      the balance must stay above, so raising it makes the model REFUSE more
//      payment dates, which pushes the payment LATER, which risks the missed
//      payment it was meant to prevent. The screen must say so next to the
//      field; 088 section B has the wording.
//
// *** THE PROJECTION REFUSES RATHER THAN GUESSES, AND THE SCREEN MUST SHOW THE
// REFUSAL. *** project() returns `{ ok: false, reason }` for a missing balance
// and never throws for a missing fact. It also returns `thresholdGaps`,
// `blindSpots`, `excluded` and `unconfirmed` — those are the answer, not
// diagnostics. A screen that renders the days and drops the gaps is showing a
// confident number built on holes, which is the exact defect this whole module
// was written to avoid.
//
// *** WIRING NOTE FOR TRACK 4. *** The projection needs bills in the CAMELCASE
// vocabulary — listRecurringBillsFor(), not listRecurringBills() — and then
// through toCashflowBills() in src/banking/cashflow-seam.mjs to expand each bill
// into dated occurrences. Feeding raw database rows to the projector threw
// nothing and produced a client with no bills at all
// (src/banking/recurring.mjs:1169).
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { SettingsError } from "../../src/banking/settings.mjs";
import { CashflowInputError } from "../../src/banking/cashflow.mjs";

/* ROLE_SETS.FINANCE — {owner, admin}. Same gate as bank-accounts and bills:
   this is bank-balance-derived data and the thresholds are an operator policy.
   bills-cashflow.html sits in public/app/shell.js OWNER_ADMIN_ONLY to match. */
const CASHFLOW_ROLES = ROLE_SETS.FINANCE;

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // Second call, deliberately — requireAuth ignores a `roles` key.
  if (!requireRole(res, staff, CASHFLOW_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) return res.status(403).json({ ok: false, error: "org_required" });

  try {
    if (req.method === "GET") {
      const q = req.query || {};

      if (q.view === "settings") {
        // TODO(track 4): loadThresholds(db, { orgId }) and configGaps(db, { orgId }).
        // Return BOTH. The gaps view reports a value even when it HAS one, until
        // a human signs it off — 052's rule, that a default which stops being
        // visible is a default nobody re-examines.
        return res.status(501).json({ ok: false, error: "not_implemented" });
      }

      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      // TODO(track 4): gather balances, bills (via listRecurringBillsFor +
      // toCashflowBills) and card liabilities for this client, then call
      // project({ balances, recurringBills, cardLiabilities, now, horizonDays,
      // thresholds }). `horizonDays` is REQUIRED — a default horizon is a policy
      // nobody stated — so read it from the query and refuse rather than pick one.
      // Pass the whole project() result to paymentWindow() when a card is named;
      // it needs the components, not just the closing balances, or it double-
      // counts the card's own minimum (src/banking/cashflow.mjs:870).
      return res.status(501).json({ ok: false, error: "not_implemented" });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }

      switch (body.action) {
        case "save_settings":
          // TODO(track 4): UPDATE cashflow_settings WHERE org_id = $1. See the
          // three rules in this file's header — especially that an explicit null
          // must clear the column rather than write a zero.
          return res.status(501).json({ ok: false, error: "not_implemented" });
        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    // Both carry their own status. SettingsError is 500 by default (a stored
    // value that is not the kind of thing the column promised is OUR problem,
    // not the caller's) and 400 when it says so; CashflowInputError is a
    // malformed argument, which is the caller's.
    if (e instanceof SettingsError) {
      return res.status(e.status || 500).json({ ok: false, error: e.message });
    }
    if (e instanceof CashflowInputError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    throw e;
  }
}

async function ownsClient(orgId, clientId) {
  const r = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), orgId]
  );
  return r.rows.length > 0;
}

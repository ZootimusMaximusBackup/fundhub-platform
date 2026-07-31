// /api/finance/cashflow — the day-by-day projection, the payment window, and
// the three operator thresholds behind both.
//
//   GET  ?client_id=<uuid>&horizon_days=<n>[&include_candidates=1]
//                          [&card_liability_id=<uuid>][&payment_amount_cents=<n>]
//                                            → { ok, projection, window, ... }
//   GET  ?view=settings                        → { ok, thresholds, gaps }
//   POST { action: "save_settings", min_buffer_cents?, confidence_floor?,
//                                   settlement_lead_days?, sign_off? }
//   POST { action: "save_reminders", client_id, horizon_days, ... }
//   POST { action: "acknowledge_reminder", reminder_id }
//
// *** THERE IS NO WRITER FOR cashflow_settings ANYWHERE IN src/. ***
// src/banking/settings.mjs is READ-ONLY: loadThresholds() reads one row and
// reshapes it, configGaps() reads a view. Both are deliberately thin and neither
// writes. So the `save_settings` action below has no module to call and the
// UPDATE is written in this file. Three rules it must not break, all of them
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
// AND A FOURTH RULE THIS FILE ADDS, because 088 describes the columns and not
// the act of writing them: CHANGING A VALUE CLEARS ITS SIGN-OFF, and SIGNING OFF
// REQUIRES SENDING THE VALUE. A sign-off is a person saying "I have looked at
// this number and I mean it" — it belongs to a number, not to a column. If a new
// value inherited the old signature, one edit would carry somebody else's
// approval onto a figure they never saw; and a sign-off with no value in the
// request would let a NULL be signed off, which removes it from
// v_cashflow_config_gaps while it is still unset — the exact way a default stops
// being visible and hardens into a fact nobody chose (052's rule).
//
// *** THE PROJECTION REFUSES RATHER THAN GUESSES, AND THE SCREEN MUST SHOW THE
// REFUSAL. *** project() returns `{ ok: false, reason }` for a missing balance
// and never throws for a missing fact. It also returns `thresholdGaps`,
// `blindSpots`, `excluded` and `unconfirmed` — those are the answer, not
// diagnostics. A screen that renders the days and drops the gaps is showing a
// confident number built on holes, which is the exact defect this whole module
// was written to avoid. Every one of them crosses the wire below.
//
// *** WIRING NOTE. *** The projection needs bills in the CAMELCASE vocabulary —
// listRecurringBillsFor(), not listRecurringBills() — and then through
// toCashflowBills() in src/banking/cashflow-seam.mjs to expand each bill into
// dated occurrences. Feeding raw database rows to the projector threw nothing
// and produced a client with no bills at all (src/banking/recurring.mjs:1169).
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { SettingsError, loadThresholds, configGaps } from "../../src/banking/settings.mjs";
import {
  CashflowInputError,
  project,
  paymentWindow,
  recordReminders
} from "../../src/banking/cashflow.mjs";
import { toCashflowBills } from "../../src/banking/cashflow-seam.mjs";
import { listRecurringBillsFor } from "../../src/banking/store.mjs";
import { PRESENTABLE_LABELS } from "../../src/banking/recurring.mjs";
import {
  ReminderError,
  createReminder,
  dueReminders,
  acknowledge
} from "../../src/banking/reminders.mjs";
import { fromCents } from "../../src/commissions/money.mjs";

/* ROLE_SETS.FINANCE — {owner, admin}. Same gate as bank-accounts and bills:
   this is bank-balance-derived data and the thresholds are an operator policy.
   bills-cashflow.html sits in public/app/shell.js OWNER_ADMIN_ONLY to match. */
const CASHFLOW_ROLES = ROLE_SETS.FINANCE;

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

/* HOW FAR THIS ENDPOINT WILL PROJECT.
   project() itself allows 3,650 days. This endpoint stops at 365, and the reason
   is the wire and not the maths: every day carries its components, so a ten-year
   projection is a multi-megabyte JSON body that no screen can draw and no
   function budget can serialise. 365 is a transport limit, stated here, and the
   refusal names it rather than silently truncating the horizon a caller asked
   for — a projection quietly shortened to a year answers a different question
   from the one that was asked. */
const MAX_HORIZON = 365;

/* THE BALANCE COLUMN THIS PROJECTION OPENS FROM, chosen once and REPORTED.
   081 defines two: `available_balance_cents` is spendable right now, and
   `current_balance_cents` is the ledger figure that lags pending activity. They
   are different facts and substituting one for the other when the other is NULL
   would put a number on screen nobody recorded. So: the ledger figure, always,
   with no fallback. An account whose ledger balance is NULL makes the whole
   projection refuse — which is correct, because summing the accounts you DO know
   produces an opening balance that is confidently too low and a payment window
   that is confidently too tight (src/banking/cashflow.mjs:556). The response
   names the column so nobody has to guess which one they are reading. */
const BALANCE_COLUMN = "current_balance_cents";

/* ------------------------------------------------------------------------- *
 * The three settings, spelled once.
 *
 * The sign-off columns do NOT share the value column's name — the buffer is
 * `min_buffer_cents` but its signature is `min_buffer_signed_off_at`, and the
 * lead is `settlement_lead_days` but `settlement_lead_signed_off_at`. Writing
 * that mapping at each call site is how a save silently signs off the wrong
 * value, so it is written here and nowhere else.
 * ------------------------------------------------------------------------- */

const SETTINGS = [
  {
    key: "min_buffer_cents",
    col: "min_buffer_cents",
    sign: "min_buffer",
    parse: (raw) => {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isSafeInteger(n)) {
        throw new SettingsError(
          "min_buffer_cents must be a whole number of cents (500 means five dollars), not " +
          JSON.stringify(raw),
          { status: 400 }
        );
      }
      if (n < 0) {
        throw new SettingsError("min_buffer_cents cannot be negative", { status: 400 });
      }
      return n;
    }
  },
  {
    key: "confidence_floor",
    col: "confidence_floor",
    sign: "confidence_floor",
    parse: (raw) => {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) {
        throw new SettingsError(
          "confidence_floor must be a number, not " + JSON.stringify(raw),
          { status: 400 }
        );
      }
      if (n < 0 || n > 1) {
        /* The commonest way to get this wrong is typing 80 for "80 per cent".
           It is refused with the reading spelled out rather than divided by a
           hundred on the caller's behalf: a caller who meant 0.8 and typed 80
           has a bug, and fixing it for them hides it. */
        throw new SettingsError(
          "confidence_floor is a fraction between 0 and 1, not a percentage — 80 per cent is 0.8",
          { status: 400 }
        );
      }
      return n;
    }
  },
  {
    key: "settlement_lead_days",
    col: "settlement_lead_days",
    sign: "settlement_lead",
    parse: (raw) => {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isSafeInteger(n)) {
        throw new SettingsError(
          "settlement_lead_days must be a whole number of days, not " + JSON.stringify(raw),
          { status: 400 }
        );
      }
      if (n < 0 || n > 30) {
        throw new SettingsError("settlement_lead_days must be between 0 and 30", { status: 400 });
      }
      return n;
    }
  }
];

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
        /* BOTH, ALWAYS. loadThresholds() says what the numbers are;
           configGaps() says which of them nobody has stood behind yet. The gaps
           view reports a value even when it HAS one, until a human signs it
           off — 052's rule, that a default which stops being visible is a
           default nobody re-examines. Returning only the values would put three
           confident figures on a screen with no hint that two of them are
           placeholders a migration picked. */
        const thresholds = await loadThresholds(db, { orgId });
        const gaps = await configGaps(db, { orgId });
        return res.status(200).json({
          ok: true,
          view: "settings",
          thresholds,
          // Present so a screen can tell "unset" from "set to zero" without
          // inspecting key presence in JavaScript, where `undefined` and a
          // missing key look identical after a JSON round trip.
          set: {
            min_buffer_cents: hasOwn(thresholds, "minBufferCents"),
            confidence_floor: hasOwn(thresholds, "confidenceFloor"),
            settlement_lead_days: hasOwn(thresholds, "settlementLeadDays")
          },
          min_buffer_display: hasOwn(thresholds, "minBufferCents")
            ? fromCents(thresholds.minBufferCents)
            : null,
          gaps
        });
      }

      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }

      const horizon = readHorizon(q.horizon_days);
      if (horizon.error) return res.status(400).json({ ok: false, error: horizon.error });

      const built = await buildProjection({
        orgId,
        clientId: String(q.client_id).trim(),
        horizonDays: horizon.days,
        includeCandidates: truthy(q.include_candidates),
        cardLiabilityId: q.card_liability_id ?? null,
        paymentAmountCents: q.payment_amount_cents ?? null
      });
      if (built.error) return res.status(built.status || 400).json({ ok: false, error: built.error });

      /* THE REMINDERS ARE COMPUTED AND NOT WRITTEN. recordReminders() is pure —
         it decides what is worth saying and returns rows; it could not store one
         if it wanted to. A GET that wrote rows would mean opening a screen
         changed the database, and a reminders list that grows every time
         somebody looks at a client is a list people stop reading. The POST
         action below is where they land. */
      const proposed = recordReminders({
        orgId,
        clientId: built.clientId,
        projection: built.projection,
        window: built.window,
        subject: built.subject
      });

      const due = await dueReminders(db, {
        orgId,
        clientId: built.clientId,
        asOf: new Date()
      });

      return res.status(200).json({ ok: true, ...built.body, reminders_due: due, reminder_candidates: proposed.reminders, reminder_skipped: proposed.skipped });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }

      switch (body.action) {
        case "save_settings": {
          const by = signedOffBy(staff);
          const written = await saveSettings(orgId, body, by);
          if (written.error) return res.status(400).json({ ok: false, error: written.error });

          // Read back through the same module the model reads through, rather
          // than reporting what was sent. If the column refused a value, or a
          // key that was not named turns out to still be unset, the answer says
          // so instead of echoing the request.
          const thresholds = await loadThresholds(db, { orgId });
          const gaps = await configGaps(db, { orgId });
          return res.status(200).json({
            ok: true,
            action: "save_settings",
            changed: written.changed,
            signed_off: written.signedOff,
            thresholds,
            min_buffer_display: hasOwn(thresholds, "minBufferCents")
              ? fromCents(thresholds.minBufferCents)
              : null,
            gaps
          });
        }

        case "save_reminders": {
          if (!isUuid(body.client_id)) {
            return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
          }
          if (!(await ownsClient(orgId, body.client_id))) {
            return res.status(403).json({ ok: false, error: "forbidden" });
          }
          const horizon = readHorizon(body.horizon_days);
          if (horizon.error) return res.status(400).json({ ok: false, error: horizon.error });

          /* RECOMPUTED HERE, NOT ACCEPTED FROM THE BROWSER. The obvious shape is
             for the screen to POST back the reminder rows it was shown, and it
             is wrong: those rows carry a body, a subject and a surface date, and
             a caller who edited them would be writing a reminder that says
             whatever they like about a client's money under this system's name.
             The projection is cheap and pure — running it again is the only way
             the stored rows are the ones the model actually justified. */
          const built = await buildProjection({
            orgId,
            clientId: String(body.client_id).trim(),
            horizonDays: horizon.days,
            includeCandidates: truthy(body.include_candidates),
            cardLiabilityId: body.card_liability_id ?? null,
            paymentAmountCents: body.payment_amount_cents ?? null
          });
          if (built.error) return res.status(built.status || 400).json({ ok: false, error: built.error });

          const proposed = recordReminders({
            orgId,
            clientId: built.clientId,
            projection: built.projection,
            window: built.window,
            subject: built.subject
          });

          /* createReminder() is idempotent BY THE DATABASE — an ON CONFLICT DO
             NOTHING against uq_cashflow_reminders_dedupe, not a guard SELECT.
             So pressing this button twice writes one row and reports the second
             press as `created: false`, and two people pressing it at once still
             write one row. Each call is its own statement on purpose: a partial
             save here leaves fewer reminders than the model justified, which is
             recoverable by pressing the button again; wrapping the loop in a
             transaction to make it all-or-nothing would buy nothing, because
             each row is a separate independent statement about a separate
             obligation. */
          const stored = [];
          for (const r of proposed.reminders) {
            const { reminder, created } = await createReminder(db, r);
            stored.push({ id: reminder.id, reminder_kind: reminder.reminder_kind, created });
          }

          const due = await dueReminders(db, { orgId, clientId: built.clientId, asOf: new Date() });
          return res.status(200).json({
            ok: true,
            action: "save_reminders",
            written: stored.filter((s) => s.created).length,
            already_there: stored.filter((s) => !s.created).length,
            skipped: proposed.skipped,
            threshold_gaps: proposed.thresholdGaps,
            reminders_due: due
          });
        }

        case "acknowledge_reminder": {
          if (!isUuid(body.reminder_id)) {
            return res.status(400).json({ ok: false, error: "reminder_id must be a uuid" });
          }
          /* READING IS NOT ACKNOWLEDGING (src/banking/reminders.mjs:205). The
             list read on GET stamps nothing; this is the only thing that clears
             a reminder, and it records WHO cleared it — a reminder that anybody
             can silently make disappear is not a record of anything. */
          const out = await acknowledge(db, {
            orgId,
            reminderId: String(body.reminder_id).trim(),
            at: new Date(),
            byKind: "staff",
            // verifySession attaches `id`, not `staff_id` — see the shape
            // documented at src/http/middleware/requireAuth.mjs:8.
            byId: staff.id ?? staff.staff_id
          });
          if (out.ok !== true) {
            // Already acknowledged. Not a failure — the reminder is in the state
            // the caller wanted it in — so it answers 200 and says who got there
            // first rather than reporting an error the person cannot act on.
            return res.status(200).json({
              ok: true,
              action: "acknowledge_reminder",
              already: true,
              reason: out.reason,
              reminder: out.reminder
            });
          }
          return res.status(200).json({
            ok: true,
            action: "acknowledge_reminder",
            already: false,
            reminder: out.reminder
          });
        }

        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    // Each of these carries its own status. SettingsError is 500 by default (a
    // stored value that is not the kind of thing the column promised is OUR
    // problem, not the caller's) and 400 when it says so; CashflowInputError is
    // a malformed argument, which is the caller's; ReminderError is 400/404/409
    // and always says which.
    if (e instanceof SettingsError) {
      return res.status(e.status || 500).json({ ok: false, error: e.message });
    }
    if (e instanceof ReminderError) {
      return res.status(e.status || 400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (e instanceof CashflowInputError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (e instanceof TypeError || e instanceof RangeError) {
      // The seam throws TypeError for a missing window bound and RangeError for
      // an unknown cadence or a reversed window. Both are this file's arguments,
      // built from the caller's query string.
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    throw e;
  }
}

/* ------------------------------------------------------------------------- *
 * The projection
 * ------------------------------------------------------------------------- */

/**
 * Everything the projection needs, gathered and handed to the pure model.
 *
 * Shared by the GET and by `save_reminders`, so the rows that get stored are
 * the rows the screen was shown. Two implementations of "what does this client's
 * month look like" would drift the first time one of them was edited.
 *
 * @returns {{error?: string, status?: number, body?: object, projection?: object,
 *            window?: object|null, subject?: object|null, clientId?: string}}
 */
async function buildProjection({
  orgId, clientId, horizonDays, includeCandidates, cardLiabilityId, paymentAmountCents
}) {
  /* THE DAY THIS PROJECTION STARTS, read from the clock ONCE and reported.
     project() has no clock — "a projection whose answer depends on when it ran
     cannot be tested or audited" — so the instant is chosen here.

     IT IS UTC, AND THAT IS A REAL LIMITATION RATHER THAN A CHOICE. There is no
     timezone column on orgs or on clients anywhere in this schema, so there is
     nothing to convert to. A projection run at 19:00 in California is dated the
     following day. It crosses the wire as `as_of` so the screen can print it;
     a date that is silently a day out is worse than one that is stated. */
  const today = new Date().toISOString().slice(0, 10);
  const endDate = addDays(today, horizonDays - 1);

  /* ── balances ──────────────────────────────────────────────────────────
     ONLY DEPOSITORY ACCOUNTS ARE CASH. 081 is explicit that there is no default
     account_type, "a default of 'depository' would quietly turn an unclassified
     line of credit into cash on hand" — so an account whose type is NULL or
     'credit' or 'loan' is left out and REPORTED, never quietly counted. A card's
     balance is a debt; adding it to the opening balance would say a client has
     money they owe. */
  const accounts = await db.query(
    `SELECT id, name, official_name, mask, account_type, closed_at,
            ${BALANCE_COLUMN} AS balance_cents, balance_as_of, currency_code
       FROM bank_accounts
      WHERE org_id = $1 AND client_id = $2
      ORDER BY created_at ASC`,
    [orgId, clientId]
  );

  const balances = [];
  const accountsExcluded = [];
  for (const a of accounts.rows) {
    const label = a.name || a.official_name || (a.mask ? `account ····${a.mask}` : null) || "(unnamed account)";
    if (a.closed_at) {
      accountsExcluded.push({ id: a.id, label, reason: "this account is recorded as closed" });
      continue;
    }
    if (a.account_type !== "depository") {
      accountsExcluded.push({
        id: a.id,
        label,
        reason: a.account_type
          ? `this is a ${a.account_type} account, not cash in a bank`
          : "nobody has recorded what kind of account this is, and an unclassified account is not cash"
      });
      continue;
    }
    balances.push({
      accountId: String(a.id),
      label,
      // NULL survives as null. project() refuses the whole projection over an
      // unknown balance and names the account, which is the correct answer:
      // there is no honest way to project from a balance nobody knows.
      balanceCents: a.balance_cents === null || a.balance_cents === undefined
        ? null
        : Number(a.balance_cents),
      asOf: instantDay(a.balance_as_of)
    });
  }

  /* ── bills ────────────────────────────────────────────────────────────
     THE CAMELCASE READ, THEN THE SEAM. listRecurringBillsFor() maps every row
     through fromBillRow(), which is where `next_expected_on` becomes
     `nextExpectedDate`. Handing raw snake_case rows to toCashflowBills() throws
     NOTHING and yields a client with no bills at all — every id renders as
     `undefined:undefined:monthly`, every confidence is NaN, and the screen says
     "you are fine" (src/banking/recurring.mjs:1169). */
  const stored = await listRecurringBillsFor(db, { orgId, clientId, presentableOnly: false });
  const detection = { bills: [], candidates: [] };
  for (const b of stored) {
    (PRESENTABLE_LABELS.includes(b.confidenceLabel) ? detection.bills : detection.candidates).push(b);
  }

  /* Candidates are excluded BY DEFAULT, the same split the detector and the
     store already make, and including them is a named act. When they ARE
     included they carry their true confidence, so the model's own
     confidenceFloor decides whether they count as confirmed — nothing is
     promoted on the way across. Either way they land in the PESSIMISTIC track
     only, which is the track a payment date is actually tested against. */
  const seam = toCashflowBills(detection, {
    from: today,
    to: endDate,
    includeCandidates
  });

  /* ── card liabilities ─────────────────────────────────────────────────
     The LATEST observation per card. 083/084 keep a history and a stale row's
     due date would put a payment on a day that has already gone. DISTINCT ON
     with the matching ORDER BY is one statement and one plan; a correlated
     max(as_of) subquery is the same answer read twice. */
  const cards = await db.query(
    `SELECT DISTINCT ON (l.tradeline_id)
            l.id, l.tradeline_id, l.as_of,
            l.payment_due_date, l.statement_date,
            l.minimum_payment_cents, l.statement_balance_cents, l.current_balance_cents,
            t.lender, t.kind
       FROM card_liabilities l
       JOIN tradelines t ON t.id = l.tradeline_id AND t.org_id = l.org_id
      WHERE l.org_id = $1 AND l.client_id = $2
      ORDER BY l.tradeline_id, l.as_of DESC, l.created_at DESC`,
    [orgId, clientId]
  );

  const cardLiabilities = cards.rows.map((c) => ({
    liabilityId: String(c.id),
    label: c.lender || "(unnamed card)",
    dueDate: dayString(c.payment_due_date),
    statementClose: dayString(c.statement_date),
    minimumPaymentCents: c.minimum_payment_cents === null || c.minimum_payment_cents === undefined
      ? null
      : Number(c.minimum_payment_cents),
    statementBalanceCents: c.statement_balance_cents === null || c.statement_balance_cents === undefined
      ? null
      : Number(c.statement_balance_cents)
  }));

  const thresholds = await loadThresholds(db, { orgId });

  const projection = project({
    balances,
    recurringBills: seam.recurringBills,
    cardLiabilities,
    now: today,
    horizonDays,
    thresholds
  });

  /* ── the payment window, when a card is named ─────────────────────────── */
  let window = null;
  let subject = null;
  if (cardLiabilityId !== null && cardLiabilityId !== undefined && cardLiabilityId !== "") {
    if (!isUuid(cardLiabilityId)) {
      return { error: "card_liability_id must be a uuid", status: 400 };
    }
    const wanted = String(cardLiabilityId).trim();
    const card = cardLiabilities.find((c) => c.liabilityId === wanted);
    if (!card) {
      // The card read is already scoped to this org and this client, so a card
      // that is not in it is either another company's or another client's. Same
      // answer either way, and it does not say which.
      return { error: "forbidden", status: 403 };
    }

    let explicitAmount = null;
    if (paymentAmountCents !== null && paymentAmountCents !== undefined && paymentAmountCents !== "") {
      const n = typeof paymentAmountCents === "number"
        ? paymentAmountCents
        : Number(String(paymentAmountCents).trim());
      if (!Number.isSafeInteger(n) || n < 0) {
        return { error: "payment_amount_cents must be a whole number of cents, zero or more", status: 400 };
      }
      explicitAmount = n;
    }

    /* PASS THE WHOLE project() RESULT, NOT A BARE ARRAY OF BALANCES.
       project() already charged this card's minimum on its due date.
       excludeSourceIds needs the per-day COMPONENTS to take that back out, and a
       plain balance array carries none — so without this the card's money leaves
       the account twice, every date looks worse than it is, and the client is
       told to pay later than they need to (src/banking/cashflow.mjs:870).
       The sourceId is the liability id, because that is what project() used. */
    window = paymentWindow({
      projectedBalances: projection,
      dueDate: card.dueDate,
      statementClose: card.statementClose,
      minimumPaymentCents: card.minimumPaymentCents,
      paymentAmountCents: explicitAmount,
      excludeSourceIds: [card.liabilityId],
      now: today,
      thresholds
    });
    /* THE FLOOR GETS A FORMATTED STRING HERE, because paymentWindow() reports it
       in cents only and the screen is not allowed to turn cents into dollars.
       Every other money value the model produces already carries one (`amount`,
       `closingBalance`, each component's `amount`); the floor is the single gap,
       and closing it here beats a browser dividing by a hundred and rendering
       123450 cents as "1234.5". */
    if (window && Number.isInteger(window.floorCents)) {
      window = { ...window, floor_display: fromCents(window.floorCents) };
    }

    subject = {
      subjectId: card.liabilityId,
      subjectLabel: card.label,
      statementClose: card.statementClose
    };
  }

  return {
    clientId,
    projection,
    window,
    subject,
    body: {
      client_id: clientId,
      as_of: today,
      as_of_note: "The day this projection starts, in UTC. There is no timezone on file for this company, so a run late in the evening in a western timezone is dated the next day.",
      horizon_days: horizonDays,
      end_date: endDate,
      balance_column: BALANCE_COLUMN,
      accounts_used: balances,
      accounts_excluded: accountsExcluded,
      bills_projected: seam.recurringBills.length,
      bills_skipped: seam.skipped,
      candidates_included: includeCandidates === true,
      candidate_count: detection.candidates.length,
      thresholds,
      card_liabilities: cardLiabilities,
      card_liability_id: subject ? subject.subjectId : null,
      projection,
      window
    }
  };
}

/* ------------------------------------------------------------------------- *
 * The settings write
 * ------------------------------------------------------------------------- */

/**
 * saveSettings — the UPDATE src/banking/settings.mjs deliberately does not have.
 *
 * ONE STATEMENT. An INSERT ... ON CONFLICT (org_id) DO UPDATE, so an org with no
 * row and an org with one take the same path and there is no read-then-write
 * window for two saves to race through.
 *
 * ONLY THE KEYS THAT WERE SENT ARE TOUCHED. A key that is absent from the body
 * is absent from the SET list, so saving the buffer cannot blank the settlement
 * lead. An explicit null (or an empty string, which is what an emptied text box
 * posts) CLEARS the column to NULL — back to "nobody has decided this", which is
 * the whole reason every column here is nullable.
 */
async function saveSettings(orgId, body, by) {
  const cols = ["org_id"];
  const vals = [orgId];
  const updates = [];
  const changed = [];
  const signedOff = [];

  const signRequest = readSignOff(body.sign_off);
  if (signRequest.error) return { error: signRequest.error };

  for (const spec of SETTINGS) {
    const asked = signRequest.set.has(spec.key);
    if (!hasOwn(body, spec.key)) {
      if (asked) {
        /* A SIGN-OFF BELONGS TO A NUMBER, NOT TO A COLUMN. Without the value in
           the same request this could sign off a NULL, which drops the setting
           out of v_cashflow_config_gaps while it is still unset — the exact way
           a default stops being visible and hardens into a fact nobody chose. */
        return {
          error: `to sign off ${spec.key} you have to send the value you are signing off — ` +
                 "a signature belongs to a number, not to a column"
        };
      }
      continue;
    }

    const raw = body[spec.key];
    const value = (raw === null || raw === "") ? null : spec.parse(raw);
    if (value === null && asked) {
      return {
        error: `${spec.key} is being cleared, and an unset value cannot be signed off — ` +
               "clearing it means nobody has decided it"
      };
    }

    push(spec.col, value);
    /* CHANGING A VALUE CLEARS ITS SIGNATURE unless the same request re-signs it.
       Otherwise one edit carries somebody else's approval onto a figure they
       never saw. Each value has its own pair of columns for exactly this
       reason — a row-level flag would let signing off the settlement lead
       silently bless a buffer nobody looked at (088 section A). */
    push(`${spec.sign}_signed_off_at`, asked ? new Date().toISOString() : null);
    push(`${spec.sign}_signed_off_by`, asked ? by : null);

    changed.push(spec.key);
    if (asked) signedOff.push(spec.key);
  }

  if (changed.length === 0) {
    return { error: "nothing to save — send min_buffer_cents, confidence_floor or settlement_lead_days" };
  }

  if (hasOwn(body, "notes")) {
    push("notes", body.notes === null || body.notes === "" ? null : String(body.notes).slice(0, 2000));
  }

  await db.query(
    `INSERT INTO cashflow_settings (${cols.join(", ")})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (org_id) DO UPDATE SET ${updates.join(", ")}, updated_at = now()`,
    vals
  );

  return { changed, signedOff };

  function push(col, value) {
    cols.push(col);
    vals.push(value);
    updates.push(`${col} = EXCLUDED.${col}`);
  }
}

/* sign_off arrives as an array of setting names. An unknown name is REFUSED
   rather than ignored: a caller who typed "min_buffer" meaning "min_buffer_cents"
   would otherwise be told the save succeeded and find the value still reported
   as unsigned, with nothing anywhere saying why. */
function readSignOff(raw) {
  const set = new Set();
  if (raw === undefined || raw === null || raw === "") return { set };
  const list = Array.isArray(raw) ? raw : [raw];
  const known = new Set(SETTINGS.map((s) => s.key));
  for (const item of list) {
    const name = String(item).trim();
    if (!known.has(name)) {
      return { error: `sign_off names a setting that does not exist: ${JSON.stringify(name)}` };
    }
    set.add(name);
  }
  return { set };
}

/* Who signed it. A name if there is one, an email if there is not, and the staff
   id as the last resort — a signature with nobody's name on it is not a
   signature, and the column is text precisely so it can hold whichever of these
   the session actually carries. */
function signedOffBy(staff) {
  const candidates = [staff?.name, staff?.email, staff?.id, staff?.staff_id];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c.trim();
  }
  return "unknown";
}

/* ------------------------------------------------------------------------- *
 * Small shared pieces
 * ------------------------------------------------------------------------- */

/* horizon_days is REQUIRED and there is no default, which is deliberate: a
   default horizon is a policy nobody stated, and "how far ahead are we looking"
   changes every number on the screen. The refusal names the range. */
function readHorizon(raw) {
  if (raw === undefined || raw === null || raw === "") {
    return { error: `horizon_days is required — say how many days ahead to project (1 to ${MAX_HORIZON})` };
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_HORIZON) {
    return { error: `horizon_days must be a whole number of days between 1 and ${MAX_HORIZON}, got ${JSON.stringify(raw)}` };
  }
  return { days: n };
}

function truthy(v) {
  if (v === true) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/* A `date` column arrives as a Date decoded to LOCAL midnight. Serialised it
   becomes "2026-07-15T00:00:00.000Z", and east of Greenwich it becomes THE DAY
   BEFORE. Reading the local parts is the only reading that recovers the stored
   day — the same rule and the same reason as fromBillRow() in
   src/banking/recurring.mjs. A due date one day out is a late payment. */
function dayString(value) {
  if (value === null || value === undefined || value === "") return null;
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  if (Number.isNaN(value.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
}

/* A `timestamptz` is an INSTANT, not a day, and it is a different conversion
   from dayString() above — which is why both exist rather than one being reused
   for the other.
 *
 * THIS ONE WAS A REAL DEFECT AND ONLY A REAL DATABASE FOUND IT. `balance_as_of`
 * is timestamptz, node-postgres hands it over as a Date OBJECT, and the first
 * version of this line was `String(value).slice(0, 10)` — which produces
 * "Fri Jul 31", because String(Date) is the human-readable form and not the ISO
 * one. project() then refused the entire projection with
 * `balances[0].asOf is not an ISO date`, so a client with a perfectly good
 * balance got no projection at all. The stub in the unit test returned a string
 * and sailed straight past it; src/http/bills-cashflow-endpoints.pg.test.mjs is
 * what caught it.
 *
 * UTC, matching the `now` this file hands the model. An instant has no calendar
 * day of its own until a timezone is chosen, and there is no timezone row in
 * this schema to choose from. */
function instantDay(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/* Whole-day arithmetic on a YYYY-MM-DD string, via UTC so no timezone can move
   the answer. Used only to work out the last day of the window handed to the
   seam; every other date in this file comes from the model. */
function addDays(day, n) {
  const [y, m, d] = String(day).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const p = (v) => String(v).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

async function ownsClient(orgId, clientId) {
  const r = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), orgId]
  );
  return r.rows.length > 0;
}

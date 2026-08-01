// POST /api/read/finance-ask { question, client_id? }
//
// Answers a small, fixed set of question SHAPES against real, already-computed
// numbers (src/finance/command-center.mjs) — it does not run a language model
// and it does not guess. A question this endpoint does not recognise, or one
// whose numbers are unknown, comes back with thin_data: true and a plain
// sentence saying what is missing. That refusal IS the answer; a screen must
// print it with the same weight as a real one (same discipline
// api/finance/alerts.mjs's REASON_TEXT map and src/underwrite/report.mjs use —
// see the header notes on those two files for why a named refusal beats a
// silent zero or a plausible-sounding guess).
//
// THREE QUESTION SHAPES, MATCHED BY KEYWORD, NOT PARSED AS NATURAL LANGUAGE:
//   "afford $X" / "can I afford X"  → compares X against known cash
//   "which card" / "pay down"       → the highest-utilization open card
//   anything else                   → thin_data: true, naming what this
//                                      endpoint can and cannot answer
//
// "am I ready for another funding round" is deliberately NOT answered with a
// number. There is no funding-readiness rule anywhere in this codebase —
// inventing a threshold here would be a business decision made inside an API
// handler, the exact thing 046_ad_platforms.sql's special_ad_category note and
// this repo's CLAUDE.md warn against. It is refused by name instead.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { commandCenter } from "../../src/finance/command-center.mjs";
import { today } from "./finance-command.mjs";

const FUNDING_READINESS_NOT_MODELED =
  "This product has no funding-readiness rule yet — no threshold for utilization, cash reserve, or " +
  "credit mix has been decided anywhere in the codebase. Answering with a number here would be a " +
  "guess wearing a chart's face. What is known: today's cash, credit, and utilization figures are on " +
  "the dashboard above; a real answer needs someone to decide what \"ready\" means first.";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!orgId) return res.status(403).json({ ok: false, error: "no_org_scope" });

  const body = req.body || {};
  const question = String(body.question || "").trim();
  if (!question) return res.status(400).json({ ok: false, error: "question is required" });

  let clientId = null;
  if (body.client_id !== undefined && body.client_id !== null && body.client_id !== "") {
    if (!isUuid(body.client_id)) return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
    clientId = String(body.client_id).trim();
    const owned = await database.query(`SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`, [clientId, orgId]);
    if (owned.rows.length === 0) return res.status(404).json({ ok: false, error: "no_such_client" });
  }

  const q = question.toLowerCase();

  const accountParams = [orgId];
  const cardParams = [orgId];
  const investParams = [orgId];
  let accountWhere = "", cardWhere = "", investWhere = "";
  if (clientId) {
    accountParams.push(clientId); accountWhere = ` AND client_id = $${accountParams.length}`;
    cardParams.push(clientId); cardWhere = ` AND client_id = $${cardParams.length}`;
    investParams.push(clientId); investWhere = ` AND ih.client_id = $${investParams.length}`;
  }

  const [bankAccounts, cards, investments] = await Promise.all([
    database.query(`SELECT account_type, current_balance_cents, closed_at FROM bank_accounts WHERE org_id = $1${accountWhere}`, accountParams),
    /* tradelines, not card_liabilities — see the header note in
       api/read/finance-command.mjs on why tradelines is the live figure. */
    database.query(
      `SELECT client_id, lender, credit_limit_cents, balance_cents AS current_balance_cents, closed_at
         FROM tradelines WHERE org_id = $1${cardWhere} AND kind <> 'installment'`,
      cardParams
    ),
    database.query(`SELECT ih.current_value_cents FROM investment_holdings ih JOIN bank_accounts ba ON ba.id = ih.bank_account_id WHERE ih.org_id = $1${investWhere}`, investParams)
  ]);

  const totals = commandCenter({
    bankAccounts: bankAccounts.rows, cards: cards.rows, investments: investments.rows
  }).totals;

  let answer;

  if (/\bready\b.*\bfund/.test(q) || /\bfund.*ready\b/.test(q)) {
    answer = { text: FUNDING_READINESS_NOT_MODELED, thin_data: true, figures: [] };
  } else if (/afford/.test(q)) {
    const m = q.match(/\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
    if (!m) {
      answer = { text: "No dollar amount found in the question — ask \"can I afford $X\".", thin_data: true, figures: [] };
    } else if (totals.cash_cents === null) {
      answer = {
        text: "Cash on hand is unknown — no open bank account in scope reports a current balance, so " +
              "this cannot be answered.",
        thin_data: true, figures: []
      };
    } else {
      const amount = Number(m[1].replace(/,/g, ""));
      const amountCents = Math.round(amount * 100);
      const can = amountCents <= totals.cash_cents;
      answer = {
        text: can
          ? `Yes — known cash on hand is $${(totals.cash_cents / 100).toFixed(2)}, which covers $${amount.toFixed(2)}.`
          : `No — known cash on hand is $${(totals.cash_cents / 100).toFixed(2)}, short of the $${amount.toFixed(2)} asked about by ` +
            `$${((amountCents - totals.cash_cents) / 100).toFixed(2)}.` +
            (totals.cash_basis.partial ? " That cash figure is a floor, not a total — some accounts did not report a balance." : ""),
        thin_data: false,
        figures: [{ label: "cash_on_hand", value: "$" + (totals.cash_cents / 100).toFixed(2) }, { label: "asked", value: "$" + amount.toFixed(2) }]
      };
    }
  } else if (/which card|pay down|pay off/.test(q)) {
    const openCards = cards.rows.filter((c) => !c.closed_at && c.credit_limit_cents !== null && Number(c.credit_limit_cents) > 0 && c.current_balance_cents !== null);
    if (!openCards.length) {
      answer = {
        text: "No open card reports both a credit limit and a current balance, so utilization cannot be " +
              "ranked — this cannot be answered.",
        thin_data: true, figures: []
      };
    } else {
      const ranked = openCards.map((c) => ({
        lender: c.lender, utilization: Number(c.current_balance_cents) / Number(c.credit_limit_cents)
      })).sort((a, b) => b.utilization - a.utilization);
      const top = ranked[0];
      answer = {
        text: `${top.lender || "The unnamed card"} — it is at ${(top.utilization * 100).toFixed(1)}% utilization, the highest of the ${ranked.length} card(s) in scope.`,
        thin_data: false,
        figures: ranked.slice(0, 5).map((r) => ({ label: r.lender || "card", value: (r.utilization * 100).toFixed(1) + "%" }))
      };
    }
  } else {
    answer = {
      text: "This can answer: \"can I afford $X\" (against known cash) and \"which card should I pay down " +
            "first\" (highest utilization). \"Am I ready for another funding round\" is answered too, but " +
            "always as a refusal — see why on that question. Nothing else is recognised yet.",
      thin_data: true, figures: []
    };
  }

  return res.status(200).json({ ok: true, as_of: today(), client_id: clientId, question, answer });
}

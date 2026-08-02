// GET /api/read/finance-command?days=<1..365>[&client_id=<uuid>][&entity_id=<uuid>]
//
// The roll-up dashboard: total cash, total credit available/owed, utilization
// overall and per card, investment balances, cash-in-vs-out over time, and
// marketing spend over the same window — across every client in the org, or
// narrowed to one client / one entity (personal vs. a business,
// 106_entities.sql). src/finance/command-center.mjs holds every rule; this file
// fetches and gates.
//
// MARKETING SPEND IS NEVER FILTERED BY client_id OR entity_id. campaigns
// (db/migrations/046_ad_platforms.sql) are scoped to a partner, not a client —
// there is no column anywhere linking an ad, a campaign, or a day of spend to
// one named client. So it is reported once, business-wide, on every response,
// and the screen must label it that way rather than imply it belongs to
// whichever client is currently filtered in.
//
// ROLE_SETS.STAFF — matches api/read/money-map.mjs and its neighbours, which
// this endpoint aggregates across.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { commandCenter } from "../../src/finance/command-center.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 365;

export function readDays(raw) {
  if (raw === undefined || raw === null || raw === "") return { days: DEFAULT_DAYS };
  const n = Number(String(raw).trim());
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_DAYS) {
    return { error: `days must be a whole number between 1 and ${MAX_DAYS}` };
  }
  return { days: n };
}

export function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const clock = deps.now || (() => new Date());

  if (req.method && req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!orgId) {
    return res.status(403).json({ ok: false, error: "no_org_scope" });
  }

  const query = req.query || {};
  const d = readDays(query.days);
  if (d.error) return res.status(400).json({ ok: false, error: d.error });

  let clientId = null;
  if (query.client_id !== undefined && query.client_id !== "") {
    if (!isUuid(query.client_id)) {
      return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
    }
    clientId = String(query.client_id).trim();
  }

  let entityId = null;
  if (query.entity_id !== undefined && query.entity_id !== "") {
    if (!isUuid(query.entity_id)) {
      return res.status(400).json({ ok: false, error: "entity_id must be a uuid" });
    }
    entityId = String(query.entity_id).trim();
  }

  try {
    if (clientId) {
      const owned = await database.query(`SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`, [clientId, orgId]);
      if (owned.rows.length === 0) return res.status(404).json({ ok: false, error: "no_such_client" });
    }
    if (entityId) {
      const owned = await database.query(`SELECT client_id FROM entities WHERE id = $1 AND org_id = $2`, [entityId, orgId]);
      if (owned.rows.length === 0) return res.status(404).json({ ok: false, error: "no_such_entity" });
      // An entity scopes to one client. Filtering by an entity from a
      // different client than the one requested would silently answer a
      // question nobody asked.
      if (clientId && owned.rows[0].client_id !== clientId) {
        return res.status(400).json({ ok: false, error: "entity_id does not belong to client_id" });
      }
      if (!clientId) clientId = owned.rows[0].client_id;
    }

    const asOf = today(clock());
    const fromDay = new Date(new Date(asOf + "T00:00:00Z").getTime() - (d.days - 1) * 86400000)
      .toISOString().slice(0, 10);

    const accountFilter = [];
    const accountParams = [orgId];
    if (clientId) { accountParams.push(clientId); accountFilter.push(`client_id = $${accountParams.length}`); }
    if (entityId) { accountParams.push(entityId); accountFilter.push(`entity_id = $${accountParams.length}`); }
    const accountWhere = accountFilter.length ? ` AND ${accountFilter.join(" AND ")}` : "";

    const bankAccountsQ = database.query(
      `SELECT id, client_id, entity_id, account_type, current_balance_cents, closed_at
         FROM bank_accounts WHERE org_id = $1${accountWhere}`,
      accountParams
    );

    /* tradelines, not card_liabilities: tradelines carries the LIVE figure
       (api/finance/liabilities.mjs's add_card/edit_card write here; os-grid.mjs
       computes the seven-row grid off this same table). card_liabilities is a
       separate CRS-observation history and does not hold the number a roll-up
       needs. installment lines are excluded, matching os-grid.mjs's DRAWABLE
       rule: "you cannot draw against an auto loan". */
    const cardFilter = [`kind <> 'installment'`];
    const cardParams = [orgId];
    if (clientId) { cardParams.push(clientId); cardFilter.push(`client_id = $${cardParams.length}`); }
    if (entityId) { cardParams.push(entityId); cardFilter.push(`entity_id = $${cardParams.length}`); }
    const cardWhere = ` AND ${cardFilter.join(" AND ")}`;

    const cardsQ = database.query(
      `SELECT client_id, entity_id, lender, credit_limit_cents, balance_cents AS current_balance_cents, closed_at
         FROM tradelines WHERE org_id = $1${cardWhere}`,
      cardParams
    );

    const investFilter = [];
    const investParams = [orgId];
    if (clientId) { investParams.push(clientId); investFilter.push(`ih.client_id = $${investParams.length}`); }
    if (entityId) { investParams.push(entityId); investFilter.push(`ba.entity_id = $${investParams.length}`); }
    const investWhere = investFilter.length ? ` AND ${investFilter.join(" AND ")}` : "";

    const investmentsQ = database.query(
      `SELECT ih.current_value_cents
         FROM investment_holdings ih
         JOIN bank_accounts ba ON ba.id = ih.bank_account_id
        WHERE ih.org_id = $1${investWhere}`,
      investParams
    );

    const txFilter = [];
    const txParams = [orgId, fromDay, asOf];
    if (clientId) { txParams.push(clientId); txFilter.push(`client_id = $${txParams.length}`); }
    if (entityId) {
      txParams.push(entityId);
      txFilter.push(`bank_account_id IN (SELECT id FROM bank_accounts WHERE entity_id = $${txParams.length})`);
    }
    const txWhere = txFilter.length ? ` AND ${txFilter.join(" AND ")}` : "";

    const cashflowQ = database.query(
      `SELECT posted_on::text AS day,
              SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS inflow_cents,
              SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END) AS outflow_cents
         FROM bank_transactions
        WHERE org_id = $1 AND posted_on BETWEEN $2 AND $3${txWhere}
        GROUP BY posted_on ORDER BY posted_on`,
      txParams
    );

    /* Business-wide, never client/entity filtered — see the header note. */
    const marketingQ = database.query(
      `SELECT m.date::text AS day, SUM(m.spend_cents) AS spend_cents
         FROM ad_metrics_daily m
        WHERE m.org_id = $1 AND m.date BETWEEN $2 AND $3
        GROUP BY m.date ORDER BY m.date`,
      [orgId, fromDay, asOf]
    );

    const [bankAccounts, cards, investments, cashflowByDay, marketingByDay] = await Promise.all([
      bankAccountsQ, cardsQ, investmentsQ, cashflowQ, marketingQ
    ]);

    const entitiesQ = clientId
      ? await database.query(
          `SELECT id, kind, name, archived_at FROM entities
            WHERE org_id = $1 AND client_id = $2 ORDER BY archived_at NULLS FIRST, kind, name`,
          [orgId, clientId]
        )
      : { rows: [] };

    const payload = commandCenter({
      bankAccounts: bankAccounts.rows,
      cards: cards.rows,
      investments: investments.rows,
      cashflowByDay: cashflowByDay.rows,
      marketingByDay: marketingByDay.rows,
      scopedToClient: !!clientId
    });

    return res.status(200).json({
      ok: true,
      as_of: asOf,
      window: { from: fromDay, to: asOf, days: d.days },
      client_id: clientId,
      entity_id: entityId,
      entities: entitiesQ.rows,
      ...payload
    });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e.code)) {
      return res.status(400).json({ ok: false, error: "bad request parameter" });
    }
    /* A DATABASE THAT DID NOT ANSWER IS NOT OUR CODE THROWING, AND THE SCREEN
       MUST NOT BE TOLD IT WAS. Everything above this line has already claimed
       the faults it can name; what is left reaches netlify/functions/api.mjs as
       a bare 500 internal_error, which public/app/data.js words as "something
       went wrong on our side ... The database did not report a problem." That
       sentence is false during an outage and it is how the funding-capacity read
       reported a dead database as a bug in this file. 503 + db:"down" is the
       shape data.js already reads as "the database is not answering".
       See src/http/db-down.mjs — it stays narrow, so anything it cannot
       positively identify still falls through to the 500 it got before. */
    if (dbDown(res, e)) return;

    throw e;
  }
}

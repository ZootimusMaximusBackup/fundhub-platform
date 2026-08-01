// GET /api/read/transactions?client_id=<uuid>[&entity_id=<uuid>][&days=<1..365>][&limit=<1..500>]
//
// One client's bank_transactions rows, newest first. This table has existed
// since migration 085 with a real writer (src/banking/import.mjs, both the
// mock provider path and wherever a real Plaid/Teller integration eventually
// lands) and, until this file, no reader anywhere — every screen that wanted a
// transaction list or a spending breakdown had nothing to read. Finance OS
// needs both, so this is the missing half.
//
// SAME SHAPE AND SAME RULES AS api/read/money-map.mjs, DELIBERATELY. Copied
// rather than re-derived, so the two cannot drift on the things that matter:
//
//   * requireAuth, then a real requireRole() call — requireAuth's third
//     argument is { db, env }, forwarded straight to authenticate(), which
//     reads only those two keys. A `roles` key there is silently dropped.
//     api/read/tradelines.mjs shipped that hole once.
//   * ROLE_SETS.STAFF, matching every other Finance OS read.
//   * ORG SCOPING FROM THE SESSION, FAILING CLOSED — never from the query
//     string, never defaulted. A client in another org is 404, not 403: the
//     distinction between "no such client" and "not yours" is only useful to
//     somebody enumerating uuids.
//   * date/timestamp columns cast to text in SQL, so a Postgres date parsed at
//     local midnight and read back with toISOString() cannot go off by one for
//     anybody east of UTC.
//   * SELECTED COLUMNS, NOT `SELECT *` — raw carries the unparsed provider
//     payload and this is a read endpoint, not a place to hand that out by
//     accident if the table ever grows a more sensitive column.
//
// entity_id NARROWS BY THE ACCOUNT'S entity_kind, THE SAME COARSE FLAG
// bank_accounts CARRIES (082_bank_account_entity_kind.sql) — NOT the richer
// 106_entities.sql entity row. bank_accounts has no entity_id column, only
// personal/business/unknown, so that is the only narrowing this endpoint can
// honestly do. entity_id here is compared against bank_accounts.entity_kind
// via a small map (personal/business); an id that is not one of this client's
// 106 entities of that kind still resolves by kind alone — this is a coarser
// filter than finance-os.html's other entity-aware reads and the screen must
// not assume it is more precise than it is.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { fromCents } from "../../src/commissions/money.mjs";

export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 365;
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

const TX_COLUMNS = `
  id, bank_account_id, amount_cents,
  posted_on::text AS posted_on, authorized_on::text AS authorized_on,
  merchant_name, category, is_pending, provider`;

export function readDays(raw) {
  if (raw === undefined || raw === null || raw === "") return { days: DEFAULT_DAYS };
  const n = Number(String(raw).trim());
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_DAYS) {
    return { error: `days must be a whole number between 1 and ${MAX_DAYS}` };
  }
  return { days: n };
}

export function readLimit(raw) {
  if (raw === undefined || raw === null || raw === "") return { limit: DEFAULT_LIMIT };
  const n = Number(String(raw).trim());
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_LIMIT) {
    return { error: `limit must be a whole number between 1 and ${MAX_LIMIT}` };
  }
  return { limit: n };
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
    return res.status(403).json({
      ok: false,
      error: "no_org_scope",
      message: "this session is not attached to an organisation, so no client data can be read"
    });
  }

  const query = req.query || {};
  if (!isUuid(query.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }
  const clientId = String(query.client_id).trim();

  if (query.entity_id !== undefined && query.entity_id !== "" && !isUuid(query.entity_id)) {
    return res.status(400).json({ ok: false, error: "entity_id must be a uuid" });
  }

  const d = readDays(query.days);
  if (d.error) return res.status(400).json({ ok: false, error: d.error });
  const l = readLimit(query.limit);
  if (l.error) return res.status(400).json({ ok: false, error: l.error });

  try {
    const client = await database.query(
      `SELECT id FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    );
    if (client.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "no_such_client" });
    }

    /* entity_kind, from the named 106_entities.sql row, if one was given —
       see the header note above on why this is the only narrowing available. */
    let entityKind = null;
    if (query.entity_id) {
      const e = await database.query(
        `SELECT kind FROM entities WHERE id = $1 AND org_id = $2 AND client_id = $3`,
        [String(query.entity_id).trim(), orgId, clientId]
      );
      if (e.rows.length === 0) {
        return res.status(400).json({ ok: false, error: "entity_id does not belong to this client" });
      }
      entityKind = e.rows[0].kind;
    }

    const asOf = today(clock());
    const params = [clientId, orgId, asOf, d.days];
    let sql = `
      SELECT ${TX_COLUMNS} FROM bank_transactions
       WHERE client_id = $1 AND org_id = $2
         AND bank_account_id IN (
           SELECT id FROM bank_accounts WHERE client_id = $1 AND org_id = $2
         )
         AND COALESCE(posted_on, authorized_on) >= ($3::date - ($4 || ' days')::interval)`;
    if (entityKind) {
      params.push(entityKind);
      sql += `
         AND bank_account_id IN (
           SELECT id FROM bank_accounts
            WHERE client_id = $1 AND org_id = $2 AND entity_kind = $${params.length}
         )`;
    }
    sql += `
       ORDER BY COALESCE(posted_on, authorized_on) DESC NULLS LAST, created_at DESC
       LIMIT $${params.length + 1}`;
    params.push(l.limit);

    const rows = (await database.query(sql, params)).rows;

    const transactions = rows.map((r) => {
      const cents = Number(r.amount_cents);
      return {
        id: r.id,
        bank_account_id: r.bank_account_id,
        amount_cents: cents,
        amount_display: fromCents(Math.abs(cents)),
        direction: cents < 0 ? "out" : "in",
        posted_on: r.posted_on,
        authorized_on: r.authorized_on,
        merchant_name: r.merchant_name,
        category: r.category,
        is_pending: r.is_pending,
        provider: r.provider
      };
    });

    /* categories — spend (outflow only) grouped by the provider's own category
       string over the same window, computed here rather than invented on the
       screen. 'null' (uncategorised) is its own bucket rather than dropped —
       an uncategorised dollar is still a real dollar Finance OS has to
       account for. */
    const byCategory = new Map();
    for (const t of transactions) {
      if (t.direction !== "out" || t.is_pending) continue;
      const key = t.category || "Uncategorized";
      byCategory.set(key, (byCategory.get(key) || 0) + Math.abs(t.amount_cents));
    }
    const categories = [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, cents]) => ({ name, cents, display: fromCents(cents) }));

    return res.status(200).json({
      ok: true,
      client_id: clientId,
      entity_kind: entityKind,
      as_of: asOf,
      days: d.days,
      transactions,
      categories
    });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e.code)) {
      return res.status(400).json({ ok: false, error: "bad request parameter" });
    }
    throw e;
  }
}

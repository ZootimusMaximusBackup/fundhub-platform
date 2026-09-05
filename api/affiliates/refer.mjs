// POST /api/affiliates/refer — "Refer a friend". Turn a client into a light
// affiliate and hand back their own share link.
//
// OWNER DECISION, docs/workflows/portal-rebuild-plan.md §4, option 2: pressing
// the button generates the client's unique share link and affiliate code and
// instantly provisions their access to the affiliate screen. One press, no
// application, no approval queue, no second login.
//
//
// *** IT IS IDEMPOTENT, AND THAT IS THE WHOLE DESIGN, NOT A NICETY. ***
//
// A second press must return the SAME code. Two affiliate rows for one person
// splits their attribution and their balance in half — api/public/partner-apply.mjs
// says so at its own :214 and reuses the row for exactly this reason, so this
// file follows it rather than inventing a second way to be careful.
//
// Three things enforce it, and no single one of them is trusted alone:
//   1. The read below returns early when accounts.affiliate_id is already set.
//   2. The whole thing runs in ONE transaction, and the account row is taken
//      with SELECT ... FOR UPDATE, so two presses that arrive together queue
//      instead of racing. Without that lock both would read "not enrolled" and
//      both would insert.
//   3. accounts_affiliate_uniq (044_accounts.sql:81) is a unique index. If a
//      path nobody has thought of ever gets past 1 and 2, Postgres refuses the
//      write rather than quietly creating the second row.
//
//
// *** WHAT IT DOES NOT DO. ***
//
// It does not change `kind`. The account stays a client, the session still
// resolves to a client principal, and no endpoint gated on ["staff","client"]
// starts admitting a new kind of caller because somebody pressed a button.
// 340_client_light_affiliate.sql is what makes a client row able to hold an
// affiliate_id at all, and its header explains why that was the small change
// and a second account was not.
//
// It does not write a commission rule. 261_affiliate_tier1_20pct_20260824.sql
// already carries the owner-set schedule — 20% direct, 5% downline — as
// org-wide rows with affiliate_id NULL, and 033_affiliates.sql:16-18 records
// that a NULL affiliate_id on a rule means "every affiliate". A new affiliate
// is therefore already on the right rate the moment the row exists. Writing a
// per-affiliate copy would be a second source of truth for a number the owner
// sets in one place, and 033:47-50 forbids restating a rate by UPDATE anyway.
//
// It does not send anything. No email, no message, no outbound call. The client
// copies their own link off the screen.
//
// It does not accept a client_id. A client principal is pinned to itself, the
// same rule api/read/portal-summary.mjs:43-51 applies. Staff are refused
// outright rather than allowed to enrol somebody else: enrolling a person into
// a commission programme is that person's decision to make, and no screen asks
// staff to make it for them.

import { db, pool } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { safeError } from "../../src/http/health.mjs";

/* The share link a client hands to a friend.
 *
 * MOVED to src/affiliates/share-link.mjs and re-exported here, because
 * src/progress/read.mjs returns the same link on every page load and a handler
 * is the wrong thing for a read path to import — see that file's header. It is
 * re-exported rather than just imported so that the several tests and callers
 * naming `refer.mjs` do not all have to move in the same commit.
 */
export { shareUrlFor } from "../../src/affiliates/share-link.mjs";
import { shareUrlFor } from "../../src/affiliates/share-link.mjs";

/* The name on the affiliate row. The account's own name first, then the
 * client's, then the email's local part. Never a blank: affiliates.name is NOT
 * NULL (db/schema/001_init.sql:419) and a row named "" is a row nobody can find
 * on the payouts desk. */
function displayName(principal, clientRow) {
  const fromAccount = principal.name && String(principal.name).trim();
  if (fromAccount) return fromAccount.slice(0, 200);
  const first = clientRow && clientRow.first_name ? String(clientRow.first_name).trim() : "";
  const last = clientRow && clientRow.last_name ? String(clientRow.last_name).trim() : "";
  const joined = [first, last].filter(Boolean).join(" ");
  if (joined) return joined.slice(0, 200);
  const email = principal.email ? String(principal.email) : "";
  const local = email.split("@")[0];
  return (local || "Referrer").slice(0, 200);
}

export default async function handler(req, res, deps = {}) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const database = deps.db || db;
  const principal = await requirePrincipal(req, res, ["client"], { db: database });
  if (!principal) return;

  // A client principal always carries both. Missing either means a session this
  // endpoint cannot scope, and an unscoped write here would create an affiliate
  // row belonging to nobody.
  if (!principal.orgId) return res.status(400).json({ ok: false, error: "org_required" });
  if (!principal.accountId) return res.status(400).json({ ok: false, error: "account_required" });

  const connect = deps.connect || (() => pool().connect());
  let client;
  try {
    client = await connect();
  } catch (err) {
    return res.status(503).json({ ok: false, error: safeError(err) });
  }

  try {
    await client.query("BEGIN");

    /* THE LOCK IS THE IDEMPOTENCY. Two presses land here at the same time on a
       double-click or a retried request; FOR UPDATE makes the second one wait
       for the first to commit, so it reads the affiliate_id the first one just
       wrote instead of deciding it needs to create one too. */
    const account = (await client.query(
      `SELECT id, org_id, kind, affiliate_id, client_id
         FROM accounts
        WHERE id = $1 AND org_id = $2
        FOR UPDATE`,
      [principal.accountId, principal.orgId]
    )).rows[0];

    if (!account) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    // ALREADY ENROLLED — the same answer as a first press, so the screen does
    // not have to care which one this is.
    if (account.affiliate_id) {
      const existing = (await client.query(
        `SELECT id, tracking_id FROM affiliates WHERE id = $1 AND org_id = $2`,
        [account.affiliate_id, principal.orgId]
      )).rows[0];
      await client.query("COMMIT");
      if (!existing || !existing.tracking_id) {
        // The link exists but the row behind it does not, or carries no code.
        // Say so rather than minting a second one on top of a broken join.
        return res.status(500).json({ ok: false, error: "affiliate_row_missing" });
      }
      return res.status(200).json({
        ok: true,
        enrolled: true,
        created: false,
        code: existing.tracking_id,
        shareUrl: shareUrlFor(existing.tracking_id, deps.env || process.env)
      });
    }

    const clientRow = account.client_id
      ? (await client.query(
          `SELECT first_name, last_name FROM clients WHERE id = $1 AND org_id = $2`,
          [account.client_id, principal.orgId]
        )).rows[0] || null
      : null;

    /* tracking_id is NOT passed. 033_affiliates.sql:125-139 assigns it in a
       BEFORE INSERT trigger off a sequence, unique per org case-insensitively
       (033:147). Generating one here would be a second code generator racing
       the first. */
    const affiliate = (await client.query(
      `INSERT INTO affiliates (org_id, name, status, activated_at)
       VALUES ($1, $2, 'active', now())
       RETURNING id, tracking_id`,
      [principal.orgId, displayName(principal, clientRow)]
    )).rows[0];

    await client.query(
      `UPDATE accounts SET affiliate_id = $1, updated_at = now()
        WHERE id = $2 AND org_id = $3 AND affiliate_id IS NULL`,
      [affiliate.id, account.id, principal.orgId]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      ok: true,
      enrolled: true,
      created: true,
      code: affiliate.tracking_id,
      shareUrl: shareUrlFor(affiliate.tracking_id, deps.env || process.env)
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* the connection is going back to the pool either way */ }
    // safeError strips DSNs and hostnames. Nothing about the person is logged.
    return res.status(500).json({ ok: false, error: safeError(err) });
  } finally {
    try { client.release(); } catch { /* already released */ }
  }
}

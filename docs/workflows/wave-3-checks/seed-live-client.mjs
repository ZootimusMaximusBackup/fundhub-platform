// Seed one client with a real file on a scratch database, then print a real
// session token for the live check to use.
//
// THE STAGE LIVES ON A PIPELINE CARD, not on the dispute case, and that is the
// thing this fixture got wrong first time round. Without the card, stage.key is
// null, and clientRepairView() then correctly withholds the expected reply date
// — it only shows one for the two stages where the bureaus really are on the
// clock. An earlier version of this file left the card out and the endpoint
// looked like it was dropping a date it had been given. It was not. It was
// being honest about a stage it did not know.
//
// Never point this at anything but a scratch database: it deletes and recreates
// its own rows by an email marker.

import { resolveDefaultOrg } from "../../../src/auth/org.mjs";
import { createAccount, createAccountSession } from "../../../src/auth/account-session.mjs";
import { moveRepairCard } from "../../../src/repair/pipeline.mjs";

const org = await resolveDefaultOrg(db);
const MARK = "livewalk";
await db.query(`DELETE FROM account_sessions WHERE account_id IN (SELECT id FROM accounts WHERE email LIKE $1)`, [`${MARK}%`]);
/* A purchase record outlives a casual account delete — paid_service_requests
   carries a foreign key to the account that asked for it, which is correct and
   is the schema refusing to lose who bought what. A scratch fixture has to clear
   it explicitly rather than be surprised by it. */
await db.query(`DELETE FROM paid_service_requests WHERE requested_by_account_id IN
  (SELECT id FROM accounts WHERE email LIKE $1)`, [`${MARK}%`]);
await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${MARK}%`]);
const old = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [`${MARK}%`])).rows.map(r=>r.id);
if (old.length) {
  await db.query(`DELETE FROM client_waypoints WHERE client_id = ANY($1)`, [old]);
  await db.query(`DELETE FROM dispute_cases WHERE client_id = ANY($1)`, [old]);
  await db.query(`DELETE FROM repair_programs WHERE client_id = ANY($1)`, [old]);
  await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [old]);
}

const c = (await db.query(
  `INSERT INTO clients (org_id, first_name, last_name, email, outcome_tier)
   VALUES ($1,'Dana','Whitlock',$2,'REPAIR_ONLY') RETURNING id`,
  [org, `${MARK}.dana@example.com`])).rows[0].id;

await db.query(`INSERT INTO repair_programs (org_id, client_id, program, rounds_cap, price_total)
                VALUES ($1,$2,'full',6,3000)`, [org, c]);
await db.query(`INSERT INTO dispute_cases (org_id, client_id, bureau, round, status, response_due_at)
                VALUES ($1,$2,'EX','R2','awaiting_response', now() + interval '20 days')`, [org, c]);
await db.query(
  `INSERT INTO client_waypoints (org_id, client_id, key, title, position, owner_kind, state, due_at)
   VALUES ($1,$2,'proof_address','Proof of address',3,'client','not_started', now() - interval '9 days')`,
  [org, c]);
await db.query(
  `INSERT INTO client_waypoints (org_id, client_id, key, title, position, owner_kind, state)
   VALUES ($1,$2,'mail_round','We post your round',4,'fundhub','in_progress')`, [org, c]);

/* THE STAGE LIVES ON A PIPELINE CARD, not on the dispute case. Without one,
   stage.key is null and clientRepairView() correctly withholds the expected
   reply date — it only shows one for the two stages where the bureaus really
   are on the clock. That is the endpoint being honest, and an earlier version of
   this fixture mistook it for a missing date. */
await moveRepairCard(db, { orgId: org, clientId: c, stageKey: "awaiting_response" });

const staff = (await db.query(`SELECT id FROM staff WHERE org_id=$1 AND role='owner' LIMIT 1`, [org])).rows[0];
const a = await createAccount(db, { orgId: org, kind: "client", email: `${MARK}.dana2@example.com`,
  password: "a-long-enough-password-1", invitedBy: staff.id, clientId: c });
const { token } = await createAccountSession(db, { accountId: a.id, orgId: org });
console.log(token);
await close();

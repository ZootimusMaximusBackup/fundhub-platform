// Partner onboarding blockers — the two surfaces a launch blocker needs.
//
// WHY THIS FILE EXISTS. The spec says to surface a launch blocker "as an onboarding
// task via create-task.mjs, not a silent failure". createTask cannot carry it:
//
//   - it throws on a `partner` assignee role, by design and with a good comment
//     ("Principal types must never own internal work")
//   - `tasks` has a client_id and no partner_id
//   - /api/tasks is requirePrincipal(["staff"]) — staff only
//
// So a createTask row is INVISIBLE to the partner who has to go and fix the
// problem. From their side that is a silent failure, which is the exact outcome the
// spec forbids. Reading the instruction literally would have satisfied the words
// and missed the point.
//
// So both happen, and neither replaces the other:
//   partner_onboarding_tasks — what the PARTNER sees in their dashboard
//   createTask()             — what FUNDHUB STAFF see in the internal queue
//
// Two audiences, two surfaces, one trigger. The internal task is best-effort: if
// createTask rejects (no client to attach to, say), the partner-visible row still
// stands, because the partner seeing their own blocker matters more than fundhub
// getting a ticket.

import { createTask } from "../lib/create-task.mjs";

/* openOnboardingTask(tx, spec) → { task, internalTask }

   Idempotent through the partial unique index in 046: one OPEN task per
   (partner, task_key, connection, campaign). A problem that recurs after being
   resolved opens a fresh row rather than being deduped against ancient history —
   which is why the index is partial on resolved_at IS NULL. */
export async function openOnboardingTask(tx, {
  orgId, partnerId, taskKey, title, detail = null, severity = "blocker",
  connectionId = null, campaignId = null,
  // The internal side. NULL clientId is fine — tasks.client_id is nullable — but
  // the role is required by createTask and is the whole reason it exists.
  notifyRole = "admin", clientId = null, eventId = null
} = {}) {
  if (!orgId || !partnerId) throw new Error("openOnboardingTask: orgId and partnerId are required");
  if (!taskKey || !title) throw new Error("openOnboardingTask: taskKey and title are required");

  const { rows } = await tx.query(
    `INSERT INTO partner_onboarding_tasks
       (org_id, partner_id, task_key, title, detail, severity, connection_id, campaign_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (partner_id, task_key, connection_id, campaign_id)
       WHERE resolved_at IS NULL
       DO UPDATE SET detail = EXCLUDED.detail, updated_at = now()
     RETURNING *`,
    [orgId, partnerId, taskKey, title, detail, severity, connectionId, campaignId]
  );
  const task = rows[0];

  // The internal mirror. Best-effort by design — see the header.
  let internalTask = null;
  try {
    internalTask = await createTask(tx, {
      orgId,
      clientId,
      title: `Partner onboarding: ${title}`,
      sourceWorkflow: "creative-factory-onboarding",
      assigneeRole: notifyRole,
      eventId: eventId || `onboarding:${partnerId}:${taskKey}:${connectionId || campaignId || "-"}`
    });
  } catch (err) {
    internalTask = { created: false, reason: `internal_task_failed: ${String(err.message).slice(0, 120)}` };
  }

  return { task, internalTask };
}

/* resolveOnboardingTask — stamp it closed. Never deletes: the history of what
   blocked a partner is worth keeping, and the partial unique index means a
   resolved row does not block a future recurrence. */
export async function resolveOnboardingTask(tx, { partnerId, taskKey, connectionId = null, campaignId = null }) {
  const { rows } = await tx.query(
    `UPDATE partner_onboarding_tasks SET resolved_at = now(), updated_at = now()
      WHERE partner_id = $1 AND task_key = $2 AND resolved_at IS NULL
        AND connection_id IS NOT DISTINCT FROM $3
        AND campaign_id   IS NOT DISTINCT FROM $4
      RETURNING id`,
    [partnerId, taskKey, connectionId, campaignId]);
  return { resolved: rows.length };
}

/* checkLaunchReadiness(tx, req) → { ready, blockers[] }

   The pre-launch check, and the place the two gates from 046 are explained in
   words rather than as a raised exception. The database enforces them regardless;
   this exists so the partner is told BEFORE they click launch, and so each blocker
   becomes a task they can act on.

   CREDIT-RELATED IS ALL THREE OFFER TYPES. funding and credit_cards are financial
   offers and credit_repair obviously so, which is why the verification gate applies
   to every campaign this module can create. Named explicitly rather than assumed,
   so a future non-credit offer type does not silently inherit the rule. */
export const CREDIT_OFFER_TYPES = new Set(["funding", "credit_cards", "credit_repair"]);

export async function checkLaunchReadiness(tx, { orgId, partnerId, campaignId } = {}) {
  const campaign = (await tx.query(
    `SELECT c.id, c.offer_type, c.platform, c.disclosure_asset_id, c.connection_id,
            conn.connection_state, conn.platform_verification_state
       FROM campaigns c
       JOIN ad_platform_connections conn ON conn.id = c.connection_id
      WHERE c.id = $1`, [campaignId])).rows[0];
  if (!campaign) { const e = new Error("campaign not found"); e.code = "NOT_FOUND"; throw e; }

  const blockers = [];

  if (campaign.connection_state !== "active") {
    blockers.push({
      task_key: "connection_not_active",
      title: `Reconnect your ${campaign.platform} account`,
      detail: `The connection is ${campaign.connection_state}. A campaign cannot launch until it is active.`
    });
  }

  if (CREDIT_OFFER_TYPES.has(campaign.offer_type)
      && campaign.platform_verification_state !== "approved") {
    blockers.push({
      task_key: "verify_business",
      title: `Complete business verification on ${campaign.platform}`,
      detail: `Verification is ${campaign.platform_verification_state}. ` +
              `${campaign.platform} requires an approved business before a ${campaign.offer_type} ` +
              `campaign can run. This is done in the platform's own Business Manager, not here.`
    });
  }

  if (campaign.offer_type === "credit_repair" && !campaign.disclosure_asset_id) {
    blockers.push({
      task_key: "link_croa_disclosure",
      title: "Link the Consumer Credit File Rights disclosure",
      detail: "Credit-repair campaigns must have the disclosure asset linked before launch."
    });
  }

  // Each blocker becomes a task on BOTH surfaces, so nothing here is a silent
  // failure on either side.
  //
  // The blockers carry task_key because that is the COLUMN name and it is what the
  // caller gets back to render; openOnboardingTask takes taskKey because that is
  // the argument name. Mapping explicitly rather than spreading, since a spread
  // silently passes task_key into a function that reads taskKey and every blocker
  // throws "taskKey is required" at the moment a partner is blocked.
  for (const b of blockers) {
    await openOnboardingTask(tx, {
      orgId, partnerId,
      taskKey: b.task_key, title: b.title, detail: b.detail,
      connectionId: campaign.connection_id, campaignId
    });
  }

  // Anything previously raised and now fixed gets stamped closed, so the dashboard
  // does not keep showing a blocker the partner has already dealt with.
  const open = new Set(blockers.map((b) => b.task_key));
  for (const key of ["connection_not_active", "verify_business", "link_croa_disclosure"]) {
    if (!open.has(key)) {
      await resolveOnboardingTask(tx, {
        partnerId, taskKey: key, connectionId: campaign.connection_id, campaignId });
    }
  }

  return { ready: blockers.length === 0, blockers };
}

export default { openOnboardingTask, resolveOnboardingTask, checkLaunchReadiness };

// Organic posting scheduler (UNIT 7).
//
// SAME RAILS AS THE PAID SIDE. Every post passes src/compliance/screen.mjs, writes
// an action_log row before it goes out, and runs inside the partner's RLS scope.
// The temptation is to treat organic as lower-stakes — but a CROA violation in an
// Instagram caption is the same violation it would be in an ad, and the regulator
// does not distinguish by placement.
//
// A FAILED POST BECOMES A TASK, not a silent 'failed' row. The spec is explicit:
// failed posts retry then surface as a task. A post that quietly failed is a
// partner who thinks they have a content calendar and does not.

import { screen } from "../compliance/screen.mjs";
import { openOnboardingTask } from "../partners/onboarding.mjs";

const MAX_ATTEMPTS = 3;

const ADAPTERS = {}; // per-channel adapters register here; injected in tests

export function registerAdapter(channel, adapter) { ADAPTERS[channel] = adapter; }

/* schedule(tx, req) → { post, state, reasons }

   Screens first, then queues. A blocked post is STORED as blocked with its
   reasons — visible in the review queue — rather than rejected and forgotten,
   which is the same rule the creative library follows.

   THREE OUTCOMES, NOT TWO. 'blocked' is stored blocked; 'needs_approval' is stored
   'awaiting_approval' and waits for a person; only 'passed' reaches 'queued'. */
export async function schedule(tx, {
  orgId, partnerId, channelId, assetId = null, caption = "", offerType, scheduledFor = null
} = {}) {
  if (!orgId || !partnerId || !channelId) {
    throw new Error("schedule: orgId, partnerId and channelId are required");
  }

  const channel = (await tx.query(
    `SELECT id, channel, connection_state, best_times, timezone
       FROM social_channels WHERE id = $1`, [channelId])).rows[0];
  if (!channel) { const e = new Error("channel not found"); e.code = "NOT_FOUND"; throw e; }

  const { rows } = await tx.query(
    `INSERT INTO social_posts
       (org_id, partner_id, channel_id, asset_id, caption, offer_type, status, scheduled_for)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',$7)
     RETURNING *`,
    [orgId, partnerId, channelId, assetId, caption, offerType,
     scheduledFor || nextBestTime(channel)]
  );
  const post = rows[0];

  const settings = (await tx.query(
    `SELECT approve_before_launch FROM partner_module_settings WHERE partner_id = $1`,
    [partnerId])).rows[0];

  const verdict = await screen(tx, {
    orgId, partnerId, subjectId: post.id, kind: "social_post",
    offerType,
    // platform is null: an organic post is not an ad placement, so the Meta
    // special-ad-category and TikTok-ad rules do not apply to it. The copy rules
    // — CROA, claims, disclosure — do, and those are what platform-null screens.
    platform: null,
    text: caption,
    approveBeforeLaunch: settings?.approve_before_launch ?? true
  });

  await tx.query(
    `INSERT INTO compliance_screenings
       (org_id, partner_id, subject_type, subject_id, offer_type, state, reasons, screened_text)
     VALUES ($1,$2,'social_post',$3,$4,$5,$6::jsonb,$7)`,
    [orgId, partnerId, post.id, offerType, verdict.state,
     JSON.stringify(verdict.reasons), String(caption).slice(0, 8000)]
  );

  if (verdict.state === "blocked") {
    const blocked = await tx.query(
      `UPDATE social_posts SET status = 'blocked', blocked_reasons = $2::jsonb
        WHERE id = $1 RETURNING *`,
      [post.id, JSON.stringify(verdict.reasons)]);
    return { post: blocked.rows[0], state: "blocked", reasons: verdict.reasons };
  }

  // 'needs_approval' IS NOT A PASS. It used to take this identical branch into
  // 'queued', and publishDue reads 'queued', so every post the engine held for a
  // person went out without one — including every credit_repair post, which
  // src/compliance/screen.mjs holds unconditionally and which no setting releases.
  // 240 adds the holding pen this line needed, and its screen gate refuses to let a
  // held post into 'queued' until approved_at is set, so the two agree.
  //
  // The paid side answers the same question in a different place, deliberately:
  // src/creative/generate.mjs (~228-237) maps both 'passed' and 'needs_approval' onto
  // the asset, because an asset does not publish on its own and its approval is
  // tracked by the campaign's approval_state. A social post DOES publish on its own,
  // so the hold has to live on the post.
  const nextStatus = verdict.state === "needs_approval" ? "awaiting_approval" : "queued";

  // The screen gate trigger lets this through only because a screening row now
  // exists for this post.
  const settled = await tx.query(
    `UPDATE social_posts SET status = $2 WHERE id = $1 RETURNING *`, [post.id, nextStatus]);
  return { post: settled.rows[0], state: verdict.state, reasons: verdict.reasons };
}

/* publishDue(tx, req) → results[]

   Posts everything due. Each post's platform call is wrapped so one channel being
   down does not stop the rest of the queue. */
export async function publishDue(tx, { orgId, partnerId, now = null, agentId = null } = {}) {
  const { rows: due } = await tx.query(
    `SELECT p.*, c.channel, c.connection_state,
            c.encrypted_access_token, c.external_account_id,
            c.partner_id AS channel_partner_id
       FROM social_posts p
       JOIN social_channels c ON c.id = p.channel_id
      -- 'queued' ONLY. A post the engine held for a person sits in
      -- 'awaiting_approval' and is invisible to this read; 240's screen gate is
      -- what stops it reaching 'queued' before somebody approves it.
      WHERE p.partner_id = $1 AND p.status = 'queued'
        AND p.scheduled_for <= COALESCE($2::timestamptz, now())
      ORDER BY p.scheduled_for
      LIMIT 50`,
    [partnerId, now]);

  const results = [];
  for (const post of due) {
    if (post.connection_state !== "active") {
      results.push({ id: post.id, skipped: "channel_not_active" });
      continue;
    }
    results.push(await publishOne(tx, { orgId, partnerId, post, agentId }));
  }
  return results;
}

async function publishOne(tx, { orgId, partnerId, post, agentId }) {
  const adapter = ADAPTERS[post.channel];

  // Logged BEFORE the call, same ordering as every paid write. A crash mid-post
  // must leave a findable record rather than a mystery.
  const logged = await tx.query(
    `INSERT INTO action_log
       (org_id, partner_id, actor, agent_id, target_type, target_id, rule_key, reason,
        before, after, undo_payload)
     VALUES ($1,$2,'agent',$3,'social_post',$4,'social_publish',$5,$6::jsonb,$7::jsonb,$8::jsonb)
     RETURNING id`,
    [orgId, partnerId, agentId, post.id, `scheduled post to ${post.channel}`,
     JSON.stringify({ status: "queued" }), JSON.stringify({ status: "posted" }),
     JSON.stringify({ action: "delete_post", post_id: post.id, channel: post.channel })]
  );
  const actionLogId = logged.rows[0].id;

  await tx.query(`UPDATE social_posts SET status = 'posting', attempt = attempt + 1 WHERE id = $1`,
    [post.id]);

  try {
    if (!adapter) throw new Error(`no adapter registered for channel ${post.channel}`);
    const out = await adapter.post(post);
    await tx.query(
      `UPDATE social_posts SET status = 'posted', posted_at = now(), external_post_id = $2,
                               last_error = NULL
        WHERE id = $1`, [post.id, out?.external_post_id || null]);
    await tx.query(`UPDATE action_log SET executed_at = now() WHERE id = $1`, [actionLogId]);
    return { id: post.id, ok: true, external_post_id: out?.external_post_id || null };
  } catch (err) {
    const message = String(err?.platformMessage || err?.message || err).slice(0, 1000);
    const attempt = Number(post.attempt || 0) + 1;
    const giveUp = attempt >= MAX_ATTEMPTS;

    await tx.query(
      `UPDATE social_posts SET status = $2, last_error = $3 WHERE id = $1`,
      [post.id, giveUp ? "failed" : "queued", message]);
    await tx.query(
      `UPDATE action_log SET executed_at = now(), execute_error = $2 WHERE id = $1`,
      [actionLogId, message]);

    // Retried and given up → a task, so it reaches a person rather than sitting in
    // a status column nobody queries.
    if (giveUp) {
      await openOnboardingTask(tx, {
        orgId, partnerId,
        taskKey: "social_post_failed",
        title: `A scheduled ${post.channel} post failed after ${attempt} attempts`,
        detail: message,
        severity: "warning"
      });
    }
    return { id: post.id, ok: false, error: message, gaveUp: giveUp };
  }
}

/* nextBestTime — the next configured slot for this channel, in its timezone.

   Returns null when nothing is configured rather than inventing a time. A post
   with a null scheduled_for stays queued until somebody sets one, which is
   visible; guessing "now" would publish content at whatever hour the job ran. */
export function nextBestTime(channel, { from = new Date() } = {}) {
  const times = channel?.best_times;
  if (!times || typeof times !== "object" || !Object.keys(times).length) return null;

  const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  for (let offset = 0; offset < 8; offset++) {
    const d = new Date(from.getTime() + offset * 864e5);
    const slots = times[DAYS[d.getUTCDay()]];
    if (!Array.isArray(slots) || !slots.length) continue;
    for (const slot of [...slots].sort()) {
      const [h, m] = String(slot).split(":").map(Number);
      if (!Number.isFinite(h)) continue;
      const when = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m || 0));
      if (when > from) return when.toISOString();
    }
  }
  return null;
}

export const CHANNELS = Object.freeze([
  "instagram", "tiktok", "facebook", "linkedin", "x", "youtube_shorts", "threads", "pinterest"
]);

export default { schedule, publishDue, registerAdapter, nextBestTime };

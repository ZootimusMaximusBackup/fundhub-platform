// Mail responses — a slug printed on a piece of paper comes back, and becomes
// an attributed row.
//
// *** NOTHING HERE MAILS. ***
// This is the RETURN direction and nothing else. It reads a slug, resolves it,
// logs the response, and stamps the record. There is no send path, no
// scheduler, no outbound call, and no activation flag in this file or reachable
// from it — see src/mail/README.md for the FCRA gate and
// db/migrations/065_mail_campaigns.sql for why there is deliberately no
// activation flag anywhere near mail.
//
//
// THE THREE TABLES AND WHICH ONE IS THE TRUTH.
//
//   mail_universe   — the record. `responded_at` and `outcome_tier` on it are
//                     the DENORMALISED LATEST STATE: one value, overwritten.
//   mail_responses  — the LOG. One row per response event, never overwritten.
//   mail_campaigns  — the drop. Joined by campaign_key = mail_universe.campaign_id,
//                     which is a soft link by string equality and not a foreign
//                     key (065's header explains why at length).
//
// 065 states outright whose job it is to keep the first two in step: "This file
// does not add a trigger to sync them; keeping them in step is the
// response-handler's job and belongs in code where it can be tested, not in a
// trigger that fires invisibly during a bulk load." This module is that code.
// recordResponse() maintains responded_at; setOutcomeTier() maintains
// outcome_tier on both sides.
//
//
// THE SLUG IS UNTRUSTED INPUT AND IS TREATED THAT WAY.
//
// A slug arrives off a public URL — a QR code on a mail piece, or a PURL typed
// into a phone. Everything downstream of it in this file obeys three rules:
//
//   1. EVERY value is a bind parameter. There is no string interpolation into
//      SQL anywhere in this file, not even for column names.
//   2. THE RAW SLUG IS NEVER REFLECTED BACK. `unknown_slug` carries a fixed
//      message with no caller-supplied text in it. A slug that does not resolve
//      is a typo, a scraped URL, or somebody probing — echoing it turns an error
//      body into a confirmation oracle and, for the probing case, into a free
//      test harness. Log it server-side if you want it; do not return it.
//   3. AN UNKNOWN SLUG IS A TYPED ERROR, NOT A 500 AND NOT A NEW ROW. It is a
//      real signal about a real thing that happened, and the one response this
//      module will never make is to invent a mail_universe row so the request
//      succeeds. A record that was never mailed cannot have responded.
//
//
// WHAT THIS MODULE DOES NOT RETURN. mail_universe.fields is the vendor's
// per-record payload — consumer PII off a prescreened file. lookupBySlug's own
// docstring flags it: "returned because the response path needs the record, NOT
// because it is safe to render". Nothing this module returns contains it. The
// response path's caller is, by construction, a public landing page.
//
//
// THIS MODULE EMITS NOTHING. The canonical event for a mail-piece response does
// not exist yet, and `mail.response` — which looks like it — is already taken by
// inbound bank email from Mailgun and is handled by onMailResponse() in
// src/handlers/comms.mjs, which writes bank_inbox rows. Emitting under that name
// would put a garbage bank_inbox row on the board for every QR scan. The name is
// PROPOSED in src/mail/PROPOSED-EVENTS.md rather than added unilaterally, per
// repo convention. recordResponse() is directly callable and complete without
// the bus; when a name is approved, a handler calls this, not the reverse.

import { lookupBySlug } from "./slugs.mjs";

/* ------------------------------------------------------------------------- *
 * Errors
 * ------------------------------------------------------------------------- */

/**
 * Every failure this module raises on its own.
 *
 * `.code` is a stable snake_case string — it is what a caller branches on and
 * what belongs in an `{ ok: false, error: "..." }` body.
 * `.status` is carried so an HTTP write endpoint can do the repo's standard
 * `catch (e) { if (e instanceof MailResponseError) ... e.status }` mapping
 * (see api/inquiries.mjs, api/pii.mjs) without a second lookup table.
 * `.message` is for a human reading a log and NEVER contains caller input.
 */
export class MailResponseError extends Error {
  constructor(message, { code = "mail_response_error", status = 400 } = {}) {
    super(message);
    this.name = "MailResponseError";
    this.code = code;
    this.status = status;
  }
}

/* ------------------------------------------------------------------------- *
 * Vocabularies
 * ------------------------------------------------------------------------- */

/**
 * RESPONSE_CHANNELS — the five values mail_responses.channel accepts.
 *
 * SOURCED, NOT CHOSEN. This is a verbatim copy of the CHECK constraint in
 * db/migrations/065_mail_campaigns.sql:
 *
 *   CONSTRAINT mail_responses_channel_ck
 *     CHECK (channel IN ('voice', 'sms', 'web', 'mail', 'email'))
 *
 * It is duplicated here so a bad channel comes back as a typed 400 with a
 * readable code instead of a raw SQLSTATE 23514 naming a constraint — the same
 * thing setStatus() does for agents (src/agents/registry.mjs). The database
 * remains the authority; this is the readable error in front of it.
 */
export const RESPONSE_CHANNELS = Object.freeze(["voice", "sms", "web", "mail", "email"]);

const CHANNEL_SET = new Set(RESPONSE_CHANNELS);

/** Is this a channel mail_responses will accept? */
export const isResponseChannel = (value) => CHANNEL_SET.has(value);

/**
 * MAIL_OUTCOME_TIERS — the closed vocabulary for mail_universe.outcome_tier on
 * a MAIL RESPONDENT.
 *
 * *** READ THIS BEFORE USING THESE VALUES. THE LIST IS A DERIVATION, NOT A
 * *** SPECIFICATION. No document in this repository states what an outcome tier
 * *** for a mail respondent is. This is reported as a gap; what follows is where
 * *** the values came from and what was rejected.
 *
 * WHAT IT IS NOT: clients.outcome_tier. There IS an existing outcome_tier
 * vocabulary — FRAUD_HOLD | MANUAL_REVIEW | REPAIR_ONLY | FUNDING_PLUS_REPAIR |
 * FULL_FUNDING | PREMIUM_STACK (001_init.sql:60) — and reusing it was the first
 * thing considered and the first thing rejected. 065's header already made this
 * call for the schema and it applies just as hard here:
 *
 *   "that is the CRS DECISION tier for a client who has already been through a
 *    soft pull. A mail respondent has not been through anything yet. Nothing in
 *    the schema or the code says the two vocabularies are the same, so this file
 *    does not assert that they are."
 *
 * A respondent has scanned a QR code. They have no credit pull, no diagnostic,
 * no decision. Labelling them FULL_FUNDING or REPAIR_ONLY would be asserting an
 * underwriting outcome that nothing has produced.
 *
 * WHAT IT IS: the stage keys of the `sales` pipeline, verbatim, from
 * db/seed/002_pipelines.sql:19 — new_lead, survey_complete, booked, confirmed,
 * showed, diagnostic_paid, decision_rendered, closed_won, downsell, lost.
 *
 * WHY THAT VOCABULARY AND NOT A NEW ONE. The response path in this thread is
 * "the ClickFunnels landing page carries the slug". A person who scans the QR
 * code lands on the funnel — which means a mail respondent's journey after the
 * response IS the sales pipeline, stage for stage, and src/adapters/clickfunnels.mjs
 * is the adapter that feeds it. So "how far did this mailed record get" already
 * has a vocabulary in this codebase with a seeded, ordered, named set of values.
 * Copying it means the tier on a mail record and the stage on the client's card
 * say the same word for the same thing. Inventing marketing labels
 * (HOT / WARM / COLD, TIER_1 / TIER_2) would have produced a second vocabulary
 * with no mapping to the first and no source at all.
 *
 * NO OTHER SUBSET DECISION WAS MADE. All ten stage keys are carried, in seed
 * order, rather than a hand-picked "reachable" subset — picking a subset would
 * itself be an unsourced judgement about which stages a mail respondent can
 * reach. src/mail/responses.pg.test.mjs asserts every value here still exists as
 * a stage key of the seeded `sales` pipeline, so if the seed moves, this list
 * fails a test instead of silently drifting.
 *
 * NULL IS NOT IN THIS LIST AND IS NOT AN ERROR. An unclassified respondent has
 * outcome_tier NULL, which means unknown, and unknown must survive. Passing
 * `tier: null` to setOutcomeTier explicitly clears the value back to unknown.
 */
export const MAIL_OUTCOME_TIERS = Object.freeze([
  "new_lead",
  "survey_complete",
  "booked",
  "confirmed",
  "showed",
  "diagnostic_paid",
  "decision_rendered",
  "closed_won",
  "downsell",
  "lost"
]);

const TIER_SET = new Set(MAIL_OUTCOME_TIERS);

/** Is this a tier this module will write? `null` is handled by the caller. */
export const isOutcomeTier = (value) => TIER_SET.has(value);

/* ------------------------------------------------------------------------- *
 * Shared guards
 * ------------------------------------------------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireDb(db, fn) {
  if (!db || typeof db.query !== "function") {
    throw new MailResponseError(`${fn}: db is required`, { code: "db_required", status: 500 });
  }
}

/**
 * A timestamptz this module will write, or a typed error.
 *
 * respondedAt IS REQUIRED AND IS NEVER DEFAULTED TO now(). mail_responses
 * separates the two times on purpose — 065: "When the person responded, which is
 * not when the row was written. A batch of call records imported on Friday
 * describes Tuesday's calls. created_at keeps the write time; this keeps the
 * truth time." Defaulting here would quietly collapse them for every importer,
 * and the collapse would be invisible because the value would look plausible.
 *
 * A live web hit passes `new Date()`, and that is not an invention: at the
 * request layer, "the scan arrived now" is an observed fact. It is only an
 * invention when a module three layers down from the request makes it up.
 */
function requireInstant(value, fn) {
  if (value === undefined || value === null || value === "") {
    throw new MailResponseError(
      `${fn}: respondedAt is required — when the person responded is a fact the caller has and this module does not`,
      { code: "responded_at_required", status: 400 }
    );
  }
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) {
    throw new MailResponseError(`${fn}: respondedAt is not a valid timestamp`, {
      code: "responded_at_invalid",
      status: 400
    });
  }
  return at;
}

/**
 * The verbatim inbound record, ready for `mail_responses.raw`.
 *
 * THE NUL CHECK IS NOT PEDANTRY. `raw` is jsonb and this payload came off a
 * public request. JSON.stringify renders a NUL byte as the six-character escape
 * backslash-u-0000, and Postgres jsonb rejects that escape outright (SQLSTATE
 * 22P05, "unsupported Unicode escape sequence") — so a single NUL byte anywhere
 * in a scanned query string turns into a database error thrown from the middle
 * of recordResponse, after validation passed. Caught here instead, before any
 * statement runs, as a typed 400.
 *
 * IT IS REFUSED RATHER THAN STRIPPED. `raw` exists to settle disputes about what
 * actually arrived (065, same rationale as tradelines.raw and bank_inbox.raw).
 * Silently editing the bytes on the way in would make it evidence of what we
 * were willing to store, not of what was sent.
 */
function normalizeRaw(payload, fn) {
  if (payload === undefined || payload === null) return {};
  if (typeof payload !== "object") {
    throw new MailResponseError(`${fn}: payload must be an object`, {
      code: "payload_not_an_object",
      status: 400
    });
  }
  let json;
  try {
    json = JSON.stringify(payload);
  } catch (err) {
    // Circular structure, or a toJSON that throws.
    throw new MailResponseError(`${fn}: payload is not serialisable as JSON`, {
      code: "payload_not_serialisable",
      status: 400
    });
  }
  if (json === undefined) {
    throw new MailResponseError(`${fn}: payload is not serialisable as JSON`, {
      code: "payload_not_serialisable",
      status: 400
    });
  }
  if (json.includes("\\u0000")) {
    throw new MailResponseError(
      `${fn}: payload contains a NUL character, which jsonb cannot store`,
      { code: "payload_not_storable", status: 400 }
    );
  }
  return payload;
}

/* ------------------------------------------------------------------------- *
 * recordResponse
 * ------------------------------------------------------------------------- */

/**
 * recordResponse(db, { slug, channel, respondedAt, payload, ... })
 *
 *   -> { recorded, deduped, responseId, mailUniverseId, orgId, campaignId,
 *        channel, respondedAt, respondedAtSet }
 *
 * A slug came back. Log it, and stamp the record it belongs to.
 *
 *
 * ORG COMES FROM THE RECORD, NEVER FROM THE CALLER. mail_responses.org_id is NOT
 * NULL, and the only trustworthy source for it is the mail_universe row the slug
 * resolved to. Accepting an orgId argument would let a public request choose
 * which org's books a response lands on.
 *
 *
 * ===== THE IDEMPOTENCY RULE =====
 *
 * *** YOU CAN ONLY DEDUPE WHAT YOU CAN IDENTIFY. ***
 *
 * Two branches, and which one applies is decided by whether the caller handed
 * over something that tells two responses apart:
 *
 *   WITH a providerRef (Twilio CallSid / MessageSid / any caller-side event id):
 *     the database adjudicates, via 065's
 *     `uq_mail_responses_provider_ref ... WHERE provider_ref IS NOT NULL`.
 *     Re-importing a call log inserts nothing the second time. Two DIFFERENT
 *     calls carry two different SIDs and both are kept — a record genuinely can
 *     respond more than once and the log must hold every one of them (065).
 *
 *   WITHOUT one — which is the PURL/QR case, and the case this thread exists for:
 *     first response per (record, channel) wins. A guard SELECT gives the
 *     readable answer, and `uq_mail_responses_anonymous` from
 *     db/migrations/067_mail_response_idempotency.sql settles the race the guard
 *     cannot: a QR code is exactly the input that arrives twice at once, because
 *     the browser retried or the person tapped again when nothing happened.
 *
 * Two identifier-less responses on the same record and channel are not "probably
 * the same person" — they are indistinguishable in every recorded respect.
 * Counting them once is a statement about what is known. Counting them twice
 * would inflate the one number a mail campaign exists to produce.
 *
 * A DEDUPED CALL IS A SUCCESS, NOT AN ERROR. It returns the response that is
 * already on file with `deduped: true`. The person scanning the QR code the
 * second time gets the same landing experience as the first; nothing about their
 * request failed.
 *
 *
 * ===== responded_at ON THE RECORD =====
 *
 * LATEST WINS, AND IT ONLY EVER MOVES FORWARD. 065 defines
 * mail_universe.responded_at as the denormalised latest state — "the
 * denormalised pair keeps the most recent" — so a genuine second response
 * advances it. The write is guarded `AND (responded_at IS NULL OR
 * responded_at < $2)`, which makes it idempotent (re-applying a value already
 * there changes nothing) and, more importantly, stops a BACKDATED import from
 * dragging it backwards: a Friday import of Tuesday's calls must not rewrite a
 * record whose PURL was hit on Thursday. `respondedAtSet` in the return says
 * whether this call actually moved it.
 *
 * updated_at is left to the trigger — mail_universe is in the set 001_init.sql
 * attaches set_updated_at() to.
 *
 *
 * ===== THE OPTIONAL LINKS =====
 *
 * providerRef, clientId and trackedNumberId are optional because the COLUMNS
 * exist (065) and a caller that has the value should not have to write raw SQL
 * to store it. Nothing in this repository supplies any of them today — reported
 * as a gap rather than faked. Omitted means NULL, which for clientId is the
 * documented normal state: "a response is a stranger until they are created as a
 * client, and most never are".
 *
 * Both id arguments are CHECKED AGAINST THE RESOLVED RECORD before use, not just
 * handed to the foreign key. An FK proves a tracked number exists; it does not
 * prove it belongs to this campaign, and a mismatched one would attribute a call
 * to the wrong drop — which is precisely the failure the tracked number exists to
 * prevent.
 */
export async function recordResponse(db, {
  slug,
  channel,
  respondedAt,
  payload = null,
  providerRef = null,
  clientId = null,
  trackedNumberId = null
} = {}) {
  const FN = "recordResponse";
  requireDb(db, FN);

  // --- input validation, all of it, before any statement runs ---------------
  // Ordered this way so that a bad request never reaches the database at all —
  // asserted by src/mail/responses.test.mjs against a db whose query() throws.

  if (typeof slug !== "string" || slug.trim() === "") {
    throw new MailResponseError(`${FN}: slug is required`, { code: "slug_required", status: 400 });
  }
  if (!isResponseChannel(channel)) {
    // The message names the allowed set, which is our own constant, and never
    // the value that was sent.
    throw new MailResponseError(
      `${FN}: channel must be one of ${RESPONSE_CHANNELS.join(", ")}`,
      { code: "unknown_channel", status: 400 }
    );
  }
  const at = requireInstant(respondedAt, FN);
  const raw = normalizeRaw(payload, FN);

  const ref = providerRef == null ? null : String(providerRef).trim() || null;
  if (clientId != null && !UUID_RE.test(String(clientId))) {
    throw new MailResponseError(`${FN}: clientId must be a uuid`, {
      code: "client_id_not_a_uuid",
      status: 400
    });
  }
  if (trackedNumberId != null && !UUID_RE.test(String(trackedNumberId))) {
    throw new MailResponseError(`${FN}: trackedNumberId must be a uuid`, {
      code: "tracked_number_id_not_a_uuid",
      status: 400
    });
  }

  // --- resolve the slug ----------------------------------------------------
  // lookupBySlug shape-checks the untrusted value, parameterises it, returns
  // null for unknown AND for ambiguous, and still throws if the database is
  // down — so null here means "no such record", not "something went wrong".
  const record = await lookupBySlug(db, { slug });
  if (!record) {
    // NO SLUG IN THIS MESSAGE, DELIBERATELY. See the header.
    throw new MailResponseError(
      `${FN}: no mailed record matches that slug`,
      { code: "unknown_slug", status: 404 }
    );
  }

  // --- the optional links, checked against the record ----------------------
  if (clientId != null) {
    const c = await db.query(`SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`, [
      clientId,
      record.org_id
    ]);
    if (!c.rows[0]) {
      throw new MailResponseError(
        `${FN}: clientId does not belong to the record's org`,
        { code: "client_org_mismatch", status: 400 }
      );
    }
  }
  if (trackedNumberId != null) {
    // mail_tracked_numbers -> mail_campaigns -> campaign_key, which is the soft
    // string link back to mail_universe.campaign_id (065). A record with a NULL
    // campaign_id matches nothing here, which is correct: an unassigned record
    // cannot have a campaign's tracked number.
    const n = await db.query(
      `SELECT 1
         FROM mail_tracked_numbers n
         JOIN mail_campaigns c ON c.id = n.mail_campaign_id
        WHERE n.id = $1 AND n.org_id = $2 AND c.campaign_key = $3`,
      [trackedNumberId, record.org_id, record.campaign_id]
    );
    if (!n.rows[0]) {
      throw new MailResponseError(
        `${FN}: trackedNumberId is not a number assigned to this record's campaign`,
        { code: "tracked_number_campaign_mismatch", status: 400 }
      );
    }
  }

  // --- the log row ---------------------------------------------------------
  const columns = `(org_id, mail_universe_id, response_at, channel, provider_ref, client_id, tracked_number_id, raw)`;
  const values = [
    record.org_id,
    record.id,
    at.toISOString(),
    channel,
    ref,
    clientId,
    trackedNumberId,
    JSON.stringify(raw)
  ];
  const returning = `RETURNING id, response_at, channel, provider_ref, client_id, tracked_number_id, created_at`;

  // The two ON CONFLICT targets are the two unique indexes, and which one can
  // fire is decided by the value of provider_ref itself — they are exact
  // complements, so only one is ever applicable to a given row.
  const conflict = ref
    ? `ON CONFLICT (provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING`
    : `ON CONFLICT (mail_universe_id, channel) WHERE provider_ref IS NULL DO NOTHING`;

  let inserted = null;
  let deduped = false;

  if (!ref) {
    // The readable half of the anonymous rule. The index below is what makes it
    // correct under concurrency; this is what makes it a sentence rather than a
    // constraint violation.
    const prior = await db.query(
      `SELECT id, response_at, channel, provider_ref, client_id, tracked_number_id, created_at
         FROM mail_responses
        WHERE mail_universe_id = $1 AND channel = $2 AND provider_ref IS NULL
        LIMIT 1`,
      [record.id, channel]
    );
    if (prior.rows[0]) {
      inserted = prior.rows[0];
      deduped = true;
    }
  }

  if (!inserted) {
    const ins = await db.query(
      `INSERT INTO mail_responses ${columns} VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ${conflict} ${returning}`,
      values
    );
    if (ins.rows[0]) {
      inserted = ins.rows[0];
    } else {
      // Lost the race (or a re-import): the index refused it. Read back the row
      // that won, so the caller gets the response that is actually on file
      // rather than a null it has to interpret.
      deduped = true;
      const existing = ref
        ? await db.query(
            `SELECT id, response_at, channel, provider_ref, client_id, tracked_number_id, created_at
               FROM mail_responses WHERE provider_ref = $1 LIMIT 1`,
            [ref]
          )
        : await db.query(
            `SELECT id, response_at, channel, provider_ref, client_id, tracked_number_id, created_at
               FROM mail_responses
              WHERE mail_universe_id = $1 AND channel = $2 AND provider_ref IS NULL
              LIMIT 1`,
            [record.id, channel]
          );
      inserted = existing.rows[0] || null;
    }
  }

  // --- the denormalised stamp ---------------------------------------------
  // Runs on the dedupe path too: it is a no-op when the value is already at or
  // past this instant, and it repairs a record whose stamp was somehow missed.
  const stamp = await db.query(
    `UPDATE mail_universe
        SET responded_at = $2::timestamptz
      WHERE id = $1
        AND (responded_at IS NULL OR responded_at < $2::timestamptz)
      RETURNING responded_at`,
    [record.id, at.toISOString()]
  );

  return {
    recorded: !!inserted && !deduped,
    deduped,
    responseId: inserted ? inserted.id : null,
    mailUniverseId: record.id,
    orgId: record.org_id,
    campaignId: record.campaign_id,
    channel,
    // The response time actually on file, which on the dedupe path is the FIRST
    // one's, not the one just passed in.
    respondedAt: inserted ? inserted.response_at : null,
    respondedAtSet: stamp.rows.length > 0
    // NOTE: `record.fields` is deliberately absent. It is consumer PII off a
    // prescreened file and the caller of this function is a public landing page.
  };
}

/* ------------------------------------------------------------------------- *
 * setOutcomeTier
 * ------------------------------------------------------------------------- */

/**
 * setOutcomeTier(db, { recordId, tier }) -> { recordId, tier, responseUpdated }
 *
 * Label how far a mailed record's respondent actually got.
 *
 * VALIDATED AGAINST A CLOSED VOCABULARY IN CODE, BECAUSE THE SCHEMA CANNOT.
 * mail_universe.outcome_tier is free text and 065 refused to add a CHECK to it
 * on purpose ("An invented tier list here would be a guess wearing a
 * constraint's clothing, and it would be enforced"). That refusal is right for a
 * migration — a constraint is expensive to be wrong about and hard to change.
 * It is not a licence for this module to write anything at all: a free-text
 * column with two writers using two spellings produces a column nobody can
 * group by. So the vocabulary lives here, where changing it is a code review.
 * See MAIL_OUTCOME_TIERS above for where the ten values came from and what was
 * rejected.
 *
 * `tier: null` IS ALLOWED AND MEANS UNKNOWN. It clears the label. There is no
 * other writer for this column, so without an explicit clear a mislabelled
 * record would stay mislabelled forever, and "unknown" is a real state that must
 * be reachable — not a hole to be plugged with the nearest plausible value.
 *
 * IT WRITES BOTH SIDES. 065 defines mail_universe.outcome_tier as the
 * denormalised latest state of the log and says keeping them in step is this
 * code's job, so the record's newest mail_responses row is stamped too. If the
 * record has no logged response the record is still labelled and
 * `responseUpdated` comes back false — that is the honest report, not a failure:
 * a tier can be set from a back-office correction on a record whose response
 * arrived before this module existed.
 */
export async function setOutcomeTier(db, { recordId, tier } = {}) {
  const FN = "setOutcomeTier";
  requireDb(db, FN);

  if (typeof recordId !== "string" || !UUID_RE.test(recordId)) {
    throw new MailResponseError(`${FN}: recordId must be a uuid`, {
      code: "record_id_not_a_uuid",
      status: 400
    });
  }
  const clearing = tier === null || tier === undefined;
  if (!clearing && !isOutcomeTier(tier)) {
    // Names the allowed set (ours), never the rejected value (theirs).
    throw new MailResponseError(
      `${FN}: tier must be null or one of ${MAIL_OUTCOME_TIERS.join(", ")}`,
      { code: "unknown_outcome_tier", status: 400 }
    );
  }
  const value = clearing ? null : tier;

  const upd = await db.query(
    `UPDATE mail_universe SET outcome_tier = $2 WHERE id = $1 RETURNING id, outcome_tier`,
    [recordId, value]
  );
  if (!upd.rows[0]) {
    throw new MailResponseError(`${FN}: no mailed record with that id`, {
      code: "unknown_record",
      status: 404
    });
  }

  // The newest response in the log, by the same ordering idx_mail_responses_record
  // is built for. id is the final tiebreak so the choice is deterministic when
  // two responses share an instant.
  const log = await db.query(
    `UPDATE mail_responses SET outcome_tier = $2
      WHERE id = (
        SELECT id FROM mail_responses
         WHERE mail_universe_id = $1
         ORDER BY response_at DESC, created_at DESC, id DESC
         LIMIT 1)
      RETURNING id`,
    [recordId, value]
  );

  return { recordId, tier: value, responseUpdated: log.rows.length > 0 };
}

/* ------------------------------------------------------------------------- *
 * attributionByCampaign
 * ------------------------------------------------------------------------- */

/**
 * attributionByCampaign(db, { campaignId, orgId }) -> the campaign's numbers.
 *
 * ===== THE BLANKS ARE THE POINT =====
 *
 * This follows the repo's reporting-function convention — unmappedProducts()
 * (src/entitlements/entitlements.mjs), unratedConversions()
 * (src/affiliates/economics.mjs), needsAttention() (src/agents/registry.mjs) —
 * whose shared idea is that a gap stays VISIBLE rather than being rounded off
 * into a number that reads like a result.
 *
 * A metric with no source comes back `null`, and every null has a matching
 * sentence in `unavailable` saying why. *** A FABRICATED ZERO IS THE FAILURE
 * MODE THIS GUARDS AGAINST. *** "0 funded" and "we cannot tell whether anyone
 * funded" render identically on a dashboard and mean opposite things, and only
 * one of them is true today.
 *
 * `mailed` IS ALWAYS null, AND WILL BE UNTIL SOMETHING RECORDS A DROP.
 * mail_universe has no mailed_at, no piece-level status, and nothing in this
 * repository observes a piece entering the post — Deluxe prints and mails, and
 * `mail_campaigns.status = 'dropped'` is a campaign-level flag a human sets
 * after the fact (065). The tempting inference — "dropped campaign, so every
 * unsuppressed record was mailed" — assumes the print file was generated from
 * this database's suppression state, and no export path exists here to make that
 * true. `loaded`, `suppressed` and `mailable` ARE real counts and are returned
 * as such; `mailable` is what could have been mailed, which is a different
 * question with a real answer.
 *
 * `funded` IS null UNTIL THE LINKAGE EXISTS. It is computable only through
 * mail_responses.client_id -> clients.funded, and mail_responses.client_id has
 * no writer in this repository (recordResponse accepts one; nothing supplies
 * one). With every client_id NULL the count is unavoidably 0, and that 0 would
 * mean "nobody funded" when it actually means "we never linked anybody". So:
 * if NOT ONE response in the campaign carries a client_id, funded is null with
 * that reason. If some do, the linkage is live and the count is real — an
 * unlinked response then means what the schema says it means, "a stranger who
 * never became a client", which is a genuine not-funded. `linkedResponses` and
 * `linkedClients` are returned either way so the basis is visible.
 *
 * ===== SCOPING =====
 *
 * mail_campaigns.campaign_key is UNIQUE, so when a campaign row exists the
 * string identifies exactly one campaign and its org is used. mail_universe.
 * campaign_id has NO such guarantee — it is free text and two orgs could use the
 * same label — so when there is no campaign row and no orgId was passed, the
 * counts span every org that used the string and `orgId` comes back null with a
 * reason. Pass orgId to scope it (Rule 7); a caller behind requireAuth already
 * has req.staff.org_id.
 */
export async function attributionByCampaign(db, { campaignId, orgId = null } = {}) {
  const FN = "attributionByCampaign";
  requireDb(db, FN);

  if (typeof campaignId !== "string" || campaignId.trim() === "") {
    throw new MailResponseError(`${FN}: campaignId is required`, {
      code: "campaign_id_required",
      status: 400
    });
  }
  if (orgId != null && !UUID_RE.test(String(orgId))) {
    throw new MailResponseError(`${FN}: orgId must be a uuid`, {
      code: "org_id_not_a_uuid",
      status: 400
    });
  }
  const key = campaignId.trim();

  // The campaign row, if one has been created. Its absence is not an error —
  // mail_universe rows can exist for a campaign_id string with no
  // mail_campaigns row behind it, which is exactly the condition 065 was written
  // to end and has not finished ending.
  const camp = await db.query(
    `SELECT id, org_id, name, status, batch_date, records_ordered
       FROM mail_campaigns WHERE campaign_key = $1 LIMIT 1`,
    [key]
  );
  const campaign = camp.rows[0] || null;
  const scope = orgId || (campaign ? campaign.org_id : null);

  const universe = await db.query(
    `SELECT count(*)::int                                        AS loaded,
            count(*) FILTER (WHERE suppressed)::int              AS suppressed,
            count(*) FILTER (WHERE NOT suppressed)::int          AS mailable,
            count(*) FILTER (WHERE responded_at IS NOT NULL)::int AS responded
       FROM mail_universe
      WHERE campaign_id = $1
        AND ($2::uuid IS NULL OR org_id = $2)`,
    [key, scope]
  );
  const u = universe.rows[0];

  const log = await db.query(
    `SELECT count(*)::int                                              AS responses,
            count(*) FILTER (WHERE r.client_id IS NOT NULL)::int        AS linked_responses,
            count(DISTINCT r.client_id)::int                            AS linked_clients,
            count(DISTINCT r.client_id) FILTER (WHERE c.funded)::int    AS funded_clients
       FROM mail_responses r
       JOIN mail_universe u ON u.id = r.mail_universe_id
       LEFT JOIN clients c  ON c.id = r.client_id
      WHERE u.campaign_id = $1
        AND ($2::uuid IS NULL OR u.org_id = $2)`,
    [key, scope]
  );
  const l = log.rows[0];

  const unavailable = {};

  // Always. See the header — there is no mailed_at anywhere and no export path
  // that would justify inferring one.
  unavailable.mailed =
    "no per-record mailed fact exists: mail_universe has no mailed_at and nothing in this repo " +
    "observes a piece entering the post. Deluxe prints and mails, and mail_campaigns.status='dropped' " +
    "is a campaign-level flag set by a human after the fact (065). `mailable` is the count of " +
    "records not suppressed, which is what could have been mailed.";

  let funded = l.funded_clients;
  if (l.linked_clients === 0) {
    funded = null;
    unavailable.funded =
      "no response in this campaign is linked to a client. funded is only computable through " +
      "mail_responses.client_id -> clients.funded, and mail_responses.client_id has no writer in " +
      "this repo, so a count here would be a 0 that means 'never linked', not 'nobody funded'.";
  }

  if (!scope) {
    unavailable.orgId =
      "no mail_campaigns row exists for this campaign_key and no orgId was passed. " +
      "mail_universe.campaign_id is free text with no uniqueness guarantee, so these counts span " +
      "every org that used the string. Pass orgId to scope them.";
  }

  return {
    campaignId: key,
    campaign: campaign
      ? {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          batchDate: campaign.batch_date,
          // The vendor-stated quantity on the order, NOT a count of rows (065's
          // NO DERIVED COUNTS). NULL means nobody recorded what was ordered.
          recordsOrdered: campaign.records_ordered
        }
      : null,
    orgId: scope,

    loaded: u.loaded,
    suppressed: u.suppressed,
    mailable: u.mailable,
    mailed: null,

    responded: u.responded,
    responses: l.responses,
    linkedResponses: l.linked_responses,
    linkedClients: l.linked_clients,
    funded,

    unavailable
  };
}

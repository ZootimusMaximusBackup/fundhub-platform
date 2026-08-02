// /api/finance/alerts — the raised-alert queue, the four rules that raise them,
// and the owner's trigger configuration.
//
//   GET  [?client_id=<uuid>][&limit=]        → { ok, alerts }   open queue, or one client's history
//   GET  ?view=triggers                      → { ok, triggers }
//   POST { action: "evaluate",    client_id[, dry_run: true] }
//   POST { action: "set_trigger", rule, enabled, threshold_bps?, threshold_score?, severity? }
//   POST { action: "acknowledge" | "resolve" | "dismiss", alert_id[, reason] }
//
// *** THE FINDING THIS ENDPOINT EXISTS FOR. *** Before evaluateAndRaise() was
// written, setting a trigger to `enabled = true` changed nothing anywhere in the
// system — the configuration surface existed and nothing read it. This endpoint
// is the other half: without a route, evaluateAndRaise() is a function nobody
// can call, which is the same defect one layer up.
//
// *** NOTHING FIRES ON AN UNKNOWN AND NOTHING FIRES ON AN UNSET THRESHOLD. ***
// evaluateAndRaise returns `{ raised, skipped }` and every skip carries a reason:
// `threshold_unset`, `utilization_unknown`, `score_unknown`, `condition_false`.
// THE SCREEN MUST SHOW THE SKIPS. "No alerts" and "we could not tell" are
// different answers, and a queue that renders only `raised` reports the second
// as the first — it tells an owner their book is clean when the truth is that
// nobody has entered the numbers yet.
//
// A FOURTH ANSWER THE STORE CANNOT GIVE, AND THIS FILE ADDS. evaluateAndRaise()
// loops the ENABLED triggers only, so a rule that is switched off — or that
// nobody has configured at all — appears in neither `raised` nor `skipped`. It
// is simply absent, and an absence renders as silence, which is the exact defect
// the paragraph above is about, one level further out. `buildRuleReport()` below
// therefore starts from TRIGGER_RULES — every rule this product has — and marks
// the unconfigured and the disabled ones `not_run` with a reason, so the screen
// can say "this rule is off" instead of showing nothing where a rule should be.
//
// *** READING AN ALERT CHANGES NOTHING. *** openAlerts() and alertsForClient()
// are SELECTs: no `surfaced_at` is stamped and no state moves. Acknowledging is
// a POST, deliberately, because reading is not acknowledging.
//
// *** THE ALERT TITLES ARE INTERNAL QUEUE TEXT AND MUST STAY THAT WAY. *** Each
// one restates numbers already on file and nothing else — no adjective about the
// client's credit, no recommendation, no projection. This is a regulated
// consumer-finance product and a claim about somebody's credit needs a human to
// sign it off. Do not render an alert title into anything customer-facing, and
// do not add wording to it here. Nothing on this route transmits: an alert is a
// row, there is no send path behind it, and none may be added.
//
// *** SEPARATE THE TWO POST FAMILIES WHEN GATING. *** `evaluate`, `acknowledge`,
// `resolve` and `dismiss` are queue work. `set_trigger` is CONFIGURATION — it
// decides which of an owner's clients get flagged and on what number — and
// setTrigger() ships every rule OFF and UNSET on purpose (079's defaults), so a
// rule that arrived switched on would start flagging real clients' credit on a
// number nobody chose. TRIGGER_ROLES below is narrower than the read gate for
// exactly that reason.
import { db, pool } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import {
  ROLE_SETS, requireRole, allowsRole, isUuid, CLIENT_DATA_ERRORS, pageParams, redact
} from "../../src/http/read-api.mjs";
import {
  AlertError, TRIGGER_RULES, SEVERITIES,
  openAlerts, alertsForClient,
  acknowledgeAlert, resolveAlert, dismissAlert,
  setTrigger, listTriggers, evaluateAndRaise
} from "../../src/alerts/store.mjs";
import { thresholdFromBps } from "../../src/alerts/evaluate.mjs";
import { listTradelines } from "../../src/tradelines/store.mjs";
import { fromCents } from "../../src/commissions/money.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

/* ROLE_SETS.STAFF — the queue is operational work and the alerts restate
   utilization and score figures api/read/tradelines.mjs already serves to this
   set. alerts.html is in the shared staff surface to match. */
const ALERT_ROLES = ROLE_SETS.STAFF;

/* CONFIGURATION IS NARROWER. Changing a threshold changes who gets flagged
   across the whole book; that is an owner decision, not a queue action. */
const TRIGGER_ROLES = ROLE_SETS.FINANCE;

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

/* WHAT EACH RULE ACTUALLY MEASURES, IN ONE PLAIN SENTENCE EACH.
 *
 * Sent by the server rather than written into the screen, for the same reason
 * `price_display` is computed server-side in api/finance/subscriptions.mjs: a
 * sentence describing a rule is an answer to "what does this do", and two copies
 * of an answer drift. The screen renders these; it does not compose them.
 *
 * EACH SENTENCE DESCRIBES THE CODE, NOT THE INTENTION. They were written by
 * reading the evaluator named against each one, and they deliberately carry no
 * adjective about anybody's credit — src/alerts/evaluate.mjs:59 refuses to
 * produce judgement words ("good", "excellent") on purpose, and a screen that
 * adds them back on the way out defeats that refusal. "Below the number you
 * set" is a comparison; "poor credit" is a claim, and a claim needs compliance
 * sign-off, not a string literal. */
const RULE_MEASURES = Object.freeze({
  utilization_over_threshold:
    "Adds up the balances on this client's open credit cards, divides by their total credit " +
    "limit, and fires when the result is above the percentage you set. Closed accounts and " +
    "loans are left out. If any card is missing a balance or a limit, nothing fires — the " +
    "answer is unknown, not clear.",
  score_below_threshold:
    "Compares the credit score on file with the score you set, and fires when the score on " +
    "file is lower. A score sitting exactly on your number does not fire. If there is no " +
    "score on file, nothing fires.",
  card_upgrade_case:
    "Looks for a documented reason to talk to this client about a better card: their total " +
    "card use is over the percentage you set, or one card is over on its own, or they are " +
    "carrying a balance on a card that costs more than their own cheapest card. It compares " +
    "the client only with themselves and says nothing about what any lender would offer."
});

/* WHY A RULE PRODUCED NOTHING, IN PLAIN WORDS. The store's reason codes are
   stable strings meant for storage and tests; these are the sentences a person
   reads. Kept here, next to the codes, so a new reason code that arrives without
   a sentence is visible as a missing key rather than as a blank line on screen —
   see `reasonText()`, which says the code out loud rather than showing nothing. */
const REASON_TEXT = Object.freeze({
  threshold_unset:
    "no threshold has been set for this rule, so it cannot fire. An unset threshold is not " +
    "zero — zero would flag everybody.",
  utilization_unknown:
    "we could not work out card use for this client. At least one card is missing its balance " +
    "or its limit, and a card we cannot read might be the one that is maxed out.",
  upsell_unknown:
    "we could not tell. At least one card is missing a figure the rule needs, so neither " +
    "'there is a case' nor 'there is no case' is true yet.",
  score_unknown: "there is no credit score on file for this client.",
  condition_false: "the rule ran and the condition was not met.",
  rule_disabled: "this rule is switched off, so it was not run.",
  rule_not_configured: "nobody has configured this rule for this company, so it was not run."
});

function reasonText(code) {
  return REASON_TEXT[code] ?? `no explanation is written for the reason code "${code}".`;
}

/* PreviewUnavailable — the dry run could not get a transaction to throw away.
 *
 * It is its own error and it is NEVER downgraded into "just run it": a preview
 * that quietly writes rows is worse than no preview at all, because the person
 * pressing it was told nothing would be written. See previewEvaluation(). */
class PreviewUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = "PreviewUnavailable";
  }
}

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // Second call, deliberately — requireAuth ignores a `roles` key.
  if (!requireRole(res, staff, ALERT_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) return res.status(403).json({ ok: false, error: "org_required" });

  try {
    if (req.method === "GET") {
      const q = req.query || {};

      if (q.view === "triggers") {
        /* EVERY RULE, NOT EVERY ROW. listTriggers() returns the rows that exist,
           and on a fresh org that is none — 079 inserts no rows on purpose. A
           screen fed only the rows would show an empty configuration page for
           the ordinary case, which reads as "there is nothing to configure"
           rather than "nothing is configured". So the list is built from
           TRIGGER_RULES and the rows are merged onto it. */
        const configured = await listTriggers(db, { orgId });
        return res.status(200).json({
          ok: true,
          /* WHETHER THIS READER MAY CHANGE ANY OF IT, SAID OUT LOUD. The queue
             is STAFF and the configuration is FINANCE, so a closer can legally
             read this list and cannot save a line of it. A screen that does not
             know that renders a Save button which 403s every time it is
             pressed — the same defect shell.js's OWNER_ADMIN_ONLY list exists to
             stop one level up, where the nav offers a screen whose data refuses
             the person clicking it. This is not the gate; the gate is the
             allowsRole() check on the write. It is what the gate will say. */
          can_configure: allowsRole(TRIGGER_ROLES, staff.role),
          triggers: TRIGGER_RULES.map((rule) => describeTrigger(rule, findRule(configured, rule)))
        });
      }

      // The store's own default is 100; pageParams caps at 200 and floors at 1,
      // so a `?limit=-1` in the address bar cannot reach Postgres as a negative
      // LIMIT (read-api.mjs:59 explains the shape of that bug).
      const { limit } = pageParams(q);

      if (q.client_id !== undefined && q.client_id !== "") {
        if (!isUuid(q.client_id)) {
          return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
        }
        if (!(await ownsClient(orgId, q.client_id))) {
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
        const clientId = String(q.client_id).trim();
        /* EVERY STATE, NOT JUST OPEN. This is the client-file read: an alert
           that was raised and then dismissed is part of what happened to this
           person, and hiding it would leave a screen unable to answer "was this
           ever flagged?". The queue read below is the one that filters. */
        const rows = await alertsForClient(db, { orgId, clientId, limit });
        return res.status(200).json({
          ok: true,
          scope: "client",
          client_id: clientId,
          limit,
          alerts: await decorateAlerts(orgId, rows)
        });
      }

      const rows = await openAlerts(db, { orgId, limit });
      return res.status(200).json({
        ok: true,
        scope: "book",
        // Said out loud because the two reads answer different questions: this
        // one is the OPEN queue, the client one is a whole history.
        state: "open",
        limit,
        alerts: await decorateAlerts(orgId, rows)
      });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }

      switch (body.action) {
        case "evaluate": {
          if (!isUuid(body.client_id)) {
            return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
          }
          if (!(await ownsClient(orgId, body.client_id))) {
            return res.status(403).json({ ok: false, error: "forbidden" });
          }
          const clientId = String(body.client_id).trim();

          /* A DRY RUN IS OPT-IN, AND IT IS OPT-IN THE SAFE WAY ROUND. Anything
             other than a literal `true` writes, because the alternative —
             treating a truthy string as a preview — would turn a real run into
             a no-op on a typo, and the owner would read "nothing fired" off a
             run that never happened. */
          const dryRun = body.dry_run === true;

          /* THE READS ARE THIS ENDPOINT'S JOB. evaluateAndRaise() is pure in,
             rows out — it fetches nothing itself (src/alerts/store.mjs:528) —
             so both reads happen here and both are org-scoped like every other
             read on this route. listTradelines() throws without an orgId rather
             than defaulting, which is what makes an unscoped read impossible to
             write by omission (src/tradelines/store.mjs:82).

             includeClosed IS TRUE ON PURPOSE. evaluateUtilization does its own
             exclusion of closed lines and installment loans and REPORTS what it
             excluded (`lines.excludedClosed`). Filtering them out in the SQL
             instead would produce the same alert with a silently smaller basis:
             the screen could no longer say "we looked at 4 of your 6 lines". */
          const tradelines = await listTradelines(db, { orgId, clientId, includeClosed: true });
          const scoreRow = await readScore(orgId, clientId);
          const asOf = asOfFor(tradelines);

          const args = {
            orgId, clientId, tradelines,
            score: scoreRow ? scoreRow.score : null,
            asOf
          };

          let outcome;
          try {
            outcome = dryRun
              ? await previewEvaluation(args)
              : await evaluateAndRaise(db, args);
          } catch (e) {
            if (e instanceof PreviewUnavailable) {
              /* 500 AND NOT 503. The database is not necessarily unwell — the
                 likeliest cause is that this process holds a handle it cannot
                 pin a connection on. data.js reads a 503 as "the database is
                 not answering", which would send whoever is on call to
                 Postgres for a fault that is ours. */
              return res.status(500).json({
                ok: false,
                error: "dry_run_unavailable",
                message: e.message
              });
            }
            throw e;
          }

          /* QUEUE THE OWNER A TEXT FOR EVERY GENUINELY NEW ALERT — never on a
             dry run, and never for a dedupe hit (out.created === false), or
             re-running "evaluate" on an alert that is still open would queue a
             second text for the same fact. 108_owner_notifications.sql is a
             queue, matching every other outbound channel in this codebase —
             nothing here sends anything; sent_at stays NULL until a real
             provider is wired in and turned on deliberately. */
          if (!dryRun) {
            for (const r of outcome.raised) {
              if (r.created !== true) continue;
              await queueOwnerNotification(db, { orgId, clientId, alert: r.alert });
            }
          }

          const triggers = await listTriggers(db, { orgId });

          return res.status(200).json({
            ok: true,
            dry_run: dryRun,
            // Belt and braces for the screen's headline: a reader should not
            // have to know that dry_run:true implies nothing was written.
            wrote: !dryRun,
            client_id: clientId,
            /* WHEN THE DATA WAS TRUE, WHICH IS NOT NOW. Null means we could not
               establish one — see asOfFor(). */
            as_of: asOf,
            inputs: {
              tradelines: tradelines.length,
              tradelines_dated: tradelines.filter((t) => t.as_of).length,
              score: scoreRow
                ? {
                    known: true,
                    score: scoreRow.score,
                    bureau: scoreRow.bureau ?? null,
                    source: scoreRow.source ?? null,
                    is_primary: scoreRow.is_primary === true,
                    recorded_at: scoreRow.created_at ?? null
                  }
                : { known: false, score: null, bureau: null, source: null, is_primary: false, recorded_at: null }
            },
            rules: buildRuleReport({ triggers, outcome, dryRun }),
            // The raw halves, kept alongside the per-rule report, because the
            // report is a rendering of them and a caller that wants the store's
            // own answer should not have to reverse-engineer it.
            raised: outcome.raised.length,
            skipped: outcome.skipped
          });
        }

        case "set_trigger": {
          // The narrower gate, checked inline rather than at the top, because
          // this is the only action that needs it. allowsRole() is the same
          // predicate requireRole uses; the 403 body is written here so it can
          // name what was refused.
          if (!allowsRole(TRIGGER_ROLES, staff.role)) {
            return res.status(403).json({
              ok: false,
              error: "forbidden",
              message: "changing a trigger is limited to " + [...TRIGGER_ROLES].join(", ")
            });
          }
          if (!TRIGGER_RULES.includes(String(body.rule || ""))) {
            return res.status(400).json({
              ok: false, error: `rule must be one of ${TRIGGER_RULES.join(", ")}`
            });
          }
          if (body.severity !== undefined && !SEVERITIES.includes(String(body.severity))) {
            return res.status(400).json({
              ok: false, error: `severity must be one of ${SEVERITIES.join(", ")}`
            });
          }

          const rule = String(body.rule);

          /* ENABLED DEFAULTS TO FALSE, WHICH IS 079's DEFAULT AND NOT A
             CONVENIENCE. A save that forgot to say leaves the rule off; a rule
             that came on by omission would start flagging real clients' credit
             on nobody's decision. Only a literal true switches it on. */
          let enabled;
          if (body.enabled === undefined || body.enabled === null) enabled = false;
          else if (typeof body.enabled === "boolean") enabled = body.enabled;
          else if (body.enabled === "true") enabled = true;
          else if (body.enabled === "false") enabled = false;
          else {
            return res.status(400).json({ ok: false, error: "enabled must be true or false" });
          }

          let thresholdBps;
          try {
            thresholdBps = readThresholdBps(body);
          } catch (e) {
            return res.status(400).json({ ok: false, error: e.message });
          }

          /* AN OMITTED THRESHOLD IS AN UNSET THRESHOLD HERE, NOT A KEPT ONE.
             setTrigger() is an UPSERT whose DO UPDATE assigns EXCLUDED for every
             column, so whatever this call does not send is CLEARED. That is the
             right behaviour for a form that always posts the whole row — which
             is what alerts.html does — and it is a trap for any other caller, so
             it is named here and in the endpoint's contract. `notes` and the
             sign-off pair are read back and passed through below for exactly
             that reason: they are NOT on the form, and clearing a note somebody
             wrote because a different field was edited is silent data loss. */
          const thresholdScore = readNullableInt(body.threshold_score);
          if (thresholdScore === INVALID) {
            return res.status(400).json({ ok: false, error: "threshold_score must be a whole number or empty" });
          }

          const existing = findRule(await listTriggers(db, { orgId }), rule);

          const row = await setTrigger(db, {
            orgId,
            rule,
            enabled,
            thresholdBps,
            thresholdScore,
            severity: body.severity === undefined ? (existing?.severity ?? "info") : String(body.severity),
            // The form has a notes box; an absent key keeps what is on file.
            notes: hasOwn(body, "notes")
              ? (String(body.notes ?? "").trim() === "" ? null : String(body.notes).trim())
              : (existing?.notes ?? null),
            // Nothing on this route signs a threshold off — that is a human
            // act and there is no control for it. Carried through so a value
            // set by any other means is not wiped by an unrelated edit.
            signedOffAt: existing?.signed_off_at ?? null,
            signedOffBy: existing?.signed_off_by ?? null
          });

          return res.status(200).json({ ok: true, trigger: describeTrigger(rule, row) });
        }

        case "acknowledge":
        case "resolve":
        case "dismiss": {
          if (!isUuid(body.alert_id)) {
            return res.status(400).json({ ok: false, error: "alert_id must be a uuid" });
          }
          const alertId = String(body.alert_id).trim();
          /* THE CLOCK IS THE HANDLER'S, NOT THE STORE'S. The store refuses to
             default `at` (src/alerts/store.mjs:359) because a module that reads
             the wall clock cannot be tested at a boundary. Acknowledging and
             resolving happen at the moment the button is pressed, so that
             moment is stamped here. It is NOT the alert's `as_of` — that is
             when the data was true and it is a different column. */
          const at = new Date().toISOString();
          const byId = staff.id ?? null;

          let result;
          if (body.action === "acknowledge") {
            result = await acknowledgeAlert(db, { orgId, alertId, at, byId });
          } else if (body.action === "resolve") {
            result = await resolveAlert(db, { orgId, alertId, at, byId });
          } else {
            result = await dismissAlert(db, { orgId, alertId, reason: body.reason ?? null });
          }

          /* A NO-OP IS A TRUE ANSWER AND IS REPORTED AS ONE. "Somebody else
             already acknowledged this" is not an error — the caller's intent is
             satisfied — so it is a 200 carrying `changed:false` and the reason.
             A row that does not exist in this org is a different answer and the
             store throws a 404 for it, which the catch below passes through.
             Collapsing the two would tell an operator their click failed when
             it did not, or that it worked when the alert was never there. */
          return res.status(200).json({
            ok: true,
            action: body.action,
            changed: result.ok === true,
            reason: result.ok === true ? null : result.reason,
            alert: (await decorateAlerts(orgId, [result.alert]))[0]
          });
        }

        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    // AlertError carries its own status: 400 for a missing argument, 409 for a
    // row that changed state mid-write.
    if (e instanceof AlertError) {
      return res.status(e.status || 400).json({ ok: false, error: e.message });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
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

async function ownsClient(orgId, clientId) {
  const r = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), orgId]
  );
  return r.rows.length > 0;
}

/* ─────────────────────────── the dry run ─────────────────────────── */

/**
 * previewEvaluation — what WOULD fire, without writing a row.
 *
 * IT IS THE REAL EVALUATION, IN A TRANSACTION THAT IS ALWAYS ROLLED BACK.
 *
 * The obvious alternative — re-implement the trigger loop here without the
 * raiseAlert() calls — was rejected on purpose. It would be a second copy of the
 * decision every rule makes (which threshold applies, what an unknown does, what
 * counts as "over"), living one directory away from the first, and CLAUDE.md §8
 * names that exact failure: "two functions doing the same thing is a bug that
 * takes months to surface". A preview that quietly disagrees with the run it is
 * previewing is worse than no preview, because it is believed.
 *
 * So the preview calls evaluateAndRaise() itself, on a pinned connection inside
 * BEGIN … ROLLBACK. There is no COMMIT anywhere in this function and no branch
 * that could add one: the ROLLBACK is in `finally`, so both the success path and
 * the failure path unwind the same way.
 *
 * WHY IT CAN REFUSE. src/db.mjs exports the shared handle as `{ query }` and
 * nothing else — no connect() — which is the trap recorded four times over in
 * this repo (audit M7): every helper that decides "can I pin a connection?" by
 * probing the handle answers NO for the one object every production caller
 * passes, and then runs the callback with autocommit. Under that bug a "dry run"
 * would WRITE ALERTS, which is the opposite of what the button says. So this
 * reaches for the pool the shared handle fronts, and if it cannot get a pinned
 * connection it throws PreviewUnavailable rather than running unpinned. Failing
 * closed is the only acceptable direction here.
 */
async function previewEvaluation(args) {
  let client;
  try {
    client = typeof db.connect === "function" ? await db.connect() : await pool().connect();
  } catch (e) {
    throw new PreviewUnavailable(
      "a preview runs the rules inside a database transaction and throws it away, and this " +
      "server could not open one, so nothing was run: " + ((e && e.message) || "no detail")
    );
  }
  if (!client || typeof client.query !== "function") {
    throw new PreviewUnavailable("a preview needs a database transaction and none was available");
  }
  try {
    await client.query("BEGIN");
    return await evaluateAndRaise(client, args);
  } finally {
    // NO COMMIT BRANCH EXISTS. Whatever happened above, the transaction is
    // discarded. A failure to roll back is reported to the log by the pool
    // when the connection is destroyed; swallowing it here keeps the original
    // error — which is the interesting one — on its way to the caller.
    try { await client.query("ROLLBACK"); } catch { /* the original error wins */ }
    client.release?.();
  }
}

/* ─────────────────────────── the inputs ─────────────────────────── */

/**
 * readScore — the credit score this org holds for this client, or null.
 *
 * `snapshots` (001_init) is the only table in this schema with a score column.
 * The primary snapshot wins where one is marked, newest otherwise; rows with no
 * score are excluded in SQL so "we hold a snapshot with no score" cannot be
 * mistaken for "the score is missing from the newest snapshot".
 *
 * NULL SURVIVES. No score on file means evaluateScore() reports `known: false`
 * and the score rule skips with `score_unknown`. Nothing here substitutes a
 * default, and nothing rounds an absent score into a low one.
 *
 * ⚠️ `snapshots` HAS NO as_of COLUMN — only created_at, which is when the row
 * was written. So the score's own as-of date is genuinely unknown and is not
 * invented here; `recorded_at` is labelled for what it is on the wire and on the
 * screen. See asOfFor() for what this costs a score_band alert.
 */
async function readScore(orgId, clientId) {
  const { rows } = await db.query(
    `SELECT score, bureau, source, is_primary, created_at
       FROM snapshots
      WHERE org_id = $1 AND client_id = $2 AND score IS NOT NULL
      ORDER BY is_primary DESC, created_at DESC
      LIMIT 1`,
    [orgId, clientId]
  );
  return rows[0] ?? null;
}

/**
 * asOfFor — when the picture these rules were run against was TRUE.
 *
 * THE OLDEST LINE DECIDES, AND ONE UNDATED LINE MAKES THE WHOLE PICTURE
 * UNDATED. A set of balances is only as current as its stalest member: reporting
 * Monday's card next to Wednesday's card as "as of Wednesday" would date a
 * figure three days later than the data behind it. And a line with no as_of
 * could have been typed at any time at all, so the moment one appears there is
 * no honest date to put on the aggregate — NULL, which 078 defines as "the
 * source data carried no as-of date — unknown, not now".
 *
 * ⚠️ KNOWN IMPRECISION, RECORDED RATHER THAN PAPERED OVER. evaluateAndRaise()
 * takes ONE asOf for every rule it runs, and this value describes the CARD data.
 * A score_band alert therefore carries the card picture's as-of, because
 * `snapshots` has no as-of column to offer instead (see readScore). The fix is a
 * column on `snapshots` and a second asOf argument in the store — a migration
 * and a store change, neither of which is this endpoint's file. Written up as a
 * finding.
 */
/* queueOwnerNotification — one row in owner_notifications per newly-raised
   alert. title/body reuse the alert's own arithmetic-only title
   (src/alerts/store.mjs's "nothing this file writes is customer-facing" rule
   applies here unchanged — the reader is staff, not the client, but a
   fabricated adjective is still a fabricated adjective). ON CONFLICT DO
   NOTHING: 108's unique index on alert_id is the actual guard against a
   duplicate text; this is belt and braces against a caller that skipped the
   `created` check above. */
async function queueOwnerNotification(db, { orgId, clientId, alert }) {
  await db.query(
    `INSERT INTO owner_notifications (org_id, alert_id, client_id, channel, title, body)
     VALUES ($1, $2, $3, 'sms', $4, $4)
     ON CONFLICT (alert_id) WHERE alert_id IS NOT NULL DO NOTHING`,
    [orgId, alert.id, clientId, alert.title]
  );
}

function asOfFor(tradelines) {
  if (!tradelines.length) return null;
  let oldest = null;
  for (const t of tradelines) {
    if (!t.as_of) return null;
    const at = new Date(t.as_of);
    if (Number.isNaN(at.getTime())) return null;
    const iso = at.toISOString();
    if (oldest === null || iso < oldest) oldest = iso;
  }
  return oldest;
}

/* ─────────────────────────── reading a threshold ─────────────────────────── */

/* A sentinel, so "the caller sent junk" is distinguishable from "the caller sent
   nothing" without throwing from a value reader. */
const INVALID = Symbol("invalid");

function readNullableInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n)) return INVALID;
  return n;
}

/**
 * readThresholdBps — the utilization threshold, in basis points, from either
 * spelling.
 *
 * THE SCREEN SPEAKS PERCENT AND THE COLUMN SPEAKS BASIS POINTS, AND THE
 * CONVERSION HAPPENS EXACTLY ONCE — here, at the boundary. That is the same rule
 * 054 and 079 state for cents and dollars, and the same one
 * api/finance/subscriptions.mjs:64 applies to money. `30` typed into a box means
 * 30%, which is 3000 basis points.
 *
 * BOTH SPELLINGS ARE ACCEPTED AND SENDING BOTH IS REFUSED. A caller who sends
 * `threshold_pct: 30` and `threshold_bps: 5000` has a bug, and picking one of
 * them on their behalf hides it.
 *
 * AN EMPTY BOX IS UNSET, NOT ZERO. `""` and null both return null, which
 * setTrigger writes as NULL and thresholdFromBps then reads as "no usable
 * threshold" — the rule refuses to fire. A zero threshold is a real, different
 * setting: it fires on every client with any balance at all.
 */
function readThresholdBps(body) {
  const hasPct = hasOwn(body, "threshold_pct");
  const hasBps = hasOwn(body, "threshold_bps");
  if (hasPct && hasBps) {
    throw new Error("send threshold_pct or threshold_bps, not both — they can disagree");
  }
  if (hasBps) {
    const n = readNullableInt(body.threshold_bps);
    if (n === INVALID) throw new Error("threshold_bps must be a whole number of basis points, or empty");
    return n;
  }
  if (hasPct) {
    const raw = body.threshold_pct;
    if (raw === undefined || raw === null || raw === "") return null;
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) throw new Error("threshold_pct must be a percentage, or empty");
    // 30.5% is 3050bp. Math.round because 30.5 * 100 is not exactly 3050 in a
    // double, and a threshold is compared as an integer everywhere downstream.
    return Math.round(n * 100);
  }
  return null;
}

/* ─────────────────────────── shaping the answer ─────────────────────────── */

function findRule(rows, rule) {
  return (rows || []).find((r) => r.rule === rule) ?? null;
}

/* A percentage for the screen, from a fraction. Null survives as null. */
function pctFromFraction(f) {
  if (f === null || f === undefined) return null;
  const n = Number(f);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10_000) / 100;
}

/* Integer cents → the 2dp string money.fromCents produces, or NULL for an
   unknown. fromCents THROWS on a non-integer (money.mjs:43), and an unknown
   arriving as null must not become an exception or a zero — it must stay
   unknown all the way to the screen, where it renders as an em dash. */
function moneyDisplay(cents) {
  if (cents === null || cents === undefined) return null;
  const n = typeof cents === "number" ? cents : Number(cents);
  if (!Number.isFinite(n)) return null;
  return fromCents(Math.round(n));
}

/**
 * describeTrigger — one rule, configured or not, as the screen needs it.
 *
 * `configured: false` and `enabled: false` are DIFFERENT and both are sent. A
 * rule nobody has ever saved and a rule somebody deliberately switched off look
 * identical in the alerts table (both produce nothing) and are not the same
 * fact about what an owner has decided.
 *
 * THE THRESHOLD IS SENT THREE WAYS AND ALL THREE PRESERVE UNSET. `threshold_bps`
 * is the column, `threshold_pct` is the same number in the unit a person reads,
 * and `threshold_display` is the string the screen prints. All three are null
 * when nothing is set, and the screen prints "not set" — never "0", which is a
 * real and much more dangerous setting.
 */
function describeTrigger(rule, row) {
  const bps = row ? row.threshold_bps : null;
  const fraction = thresholdFromBps(bps === undefined ? null : bps);
  const usesScore = rule === "score_below_threshold";
  const score = row ? row.threshold_score : null;

  return {
    rule,
    measures: RULE_MEASURES[rule] ?? null,
    configured: Boolean(row),
    enabled: row ? row.enabled === true : false,
    // Which of the two threshold columns this rule actually reads. Sent so the
    // screen does not have to know the mapping, and cannot get it wrong.
    threshold_kind: usesScore ? "score" : "utilization",
    threshold_bps: bps ?? null,
    threshold_pct: fraction === null ? null : pctFromFraction(fraction),
    threshold_score: score ?? null,
    threshold_display: usesScore
      ? (score === null || score === undefined ? null : String(score))
      : (fraction === null ? null : `${pctFromFraction(fraction)}%`),
    severity: row ? row.severity : null,
    notes: row ? (row.notes ?? null) : null,
    signed_off_at: row ? (row.signed_off_at ?? null) : null,
    updated_at: row ? (row.updated_at ?? null) : null
  };
}

/**
 * figuresFor — the numbers behind an alert, already formatted, with unknown
 * preserved.
 *
 * FORMATTED HERE AND NOT IN THE BROWSER. Money is integer cents in `detail` and
 * money.fromCents() is the one function in this repo that turns cents into a
 * string; a screen that did it itself would be a second answer to how money
 * looks, and JavaScript floats would make it a wrong one. Every figure carries
 * `display: null` when the underlying value is unknown, and the screen renders
 * that as an em dash — never as 0.00.
 *
 * `partial` marks a figure totalled over a set with holes in it. It is a FLOOR,
 * not a total, and finance-os.css draws it with a "+".
 */
function figuresFor(row) {
  const d = (row && row.detail) || {};
  const out = [];
  const add = (label, display, extra = {}) => out.push({ label, display, partial: false, ...extra });

  if (row.kind === "utilization_threshold") {
    const partial = d.partial === true;
    add("Card use", d.utilizationPct === null || d.utilizationPct === undefined ? null : `${d.utilizationPct}%`, { partial });
    add("Your threshold", d.threshold === null || d.threshold === undefined ? null : `${pctFromFraction(d.threshold)}%`);
    add("Total balance", moneyDisplay(d.balanceCents), { partial });
    add("Total credit limit", moneyDisplay(d.limitCents), { partial });
    if (d.lines) {
      add("Cards read", `${d.lines.known} of ${d.lines.counted} counted`);
      if (d.lines.unknown > 0) {
        add("Cards we could not read", String(d.lines.unknown));
      }
    }
  } else if (row.kind === "score_band") {
    add("Score on file", d.score === null || d.score === undefined ? null : String(d.score));
    add("Band", d.band ?? null);
    add(
      "Clears the funding-call gate",
      d.meetsFundingCallGate === null || d.meetsFundingCallGate === undefined
        ? null
        : (d.meetsFundingCallGate ? "yes" : "no")
    );
  } else if (row.kind === "upsell_opportunity") {
    const codes = Array.isArray(d.reasons) ? d.reasons.map((r) => r && r.code).filter(Boolean) : [];
    add("Cases found", codes.length ? codes.join(", ") : null);
    /* THE SAVING FIGURE IS AN ARITHMETIC STATEMENT, NOT A PROJECTION, and the
       label says so in full. src/alerts/evaluate.mjs:600 spells out what it
       assumes: today's balance, no fees, no promo rate, and no view on whether
       a transfer would even be approved. A label reading "you could save
       $X" would be a claim about a credit outcome. */
    add("One year of the rate difference, at today's balances",
      moneyDisplay(d.estimatedAnnualSavingCents));
    const u = d.utilization || {};
    add("Card use", u.utilizationPct === null || u.utilizationPct === undefined ? null : `${u.utilizationPct}%`,
      { partial: u.partial === true });
  }

  return out;
}

/**
 * decorateAlerts — alert rows plus the client's name and the numbers behind
 * each one.
 *
 * THE NAME LOOKUP IS ORG-SCOPED TOO. Every id here came out of an org-scoped
 * read, so this is belt and braces — and belt and braces is the posture this
 * route takes everywhere, because the store's readers are the only thing
 * standing between an id and somebody else's client (src/alerts/store.mjs
 * scopes all of its own, but a future join might not).
 *
 * A CLIENT WITH NO NAME ON FILE STAYS NULL. The screen prints the shortened id
 * and says so, rather than printing "Unknown Client" as though that were a name.
 */
async function decorateAlerts(orgId, rows) {
  const list = (rows || []).filter(Boolean);
  if (!list.length) return [];

  const ids = [...new Set(list.map((r) => r.client_id).filter(Boolean))];
  const names = new Map();
  if (ids.length) {
    const { rows: clients } = await db.query(
      `SELECT id, first_name, last_name FROM clients WHERE org_id = $1 AND id = ANY($2::uuid[])`,
      [orgId, ids]
    );
    for (const c of clients) {
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
      names.set(String(c.id), name === "" ? null : name);
    }
  }

  return list.map((r) => ({
    ...redact(r),
    client_name: r.client_id ? (names.get(String(r.client_id)) ?? null) : null,
    figures: figuresFor(r)
  }));
}

/**
 * buildRuleReport — one row per rule this product has, with what happened to it.
 *
 * THE POINT OF THIS FUNCTION IS THE `not_run` CASE. evaluateAndRaise() reports
 * on the enabled rules only, so a rule that is off produces neither a raise nor
 * a skip and would render as nothing at all — and nothing at all reads as "we
 * checked and you are fine". Starting from TRIGGER_RULES makes the silence
 * impossible: every rule appears, every rule has an outcome, and an outcome of
 * "we did not run this" is stated in those words.
 *
 * Outcomes, all five, deliberately distinct:
 *   raised / would_raise — the condition is true (would_raise on a dry run)
 *   already_open         — true, and an alert for it is already open; nothing new
 *   no                   — the rule ran and the condition was false
 *   cannot_tell          — the rule ran and the data would not answer
 *   not_run              — the rule was off, unconfigured, or has no threshold
 */
function buildRuleReport({ triggers, outcome, dryRun }) {
  const raisedBy = new Map();
  for (const r of outcome.raised) raisedBy.set(r.rule, r);
  const skippedBy = new Map();
  for (const s of outcome.skipped) skippedBy.set(s.rule, s);

  return TRIGGER_RULES.map((rule) => {
    const base = describeTrigger(rule, findRule(triggers, rule));

    const hit = raisedBy.get(rule);
    if (hit) {
      return {
        ...base,
        outcome: hit.created ? (dryRun ? "would_raise" : "raised") : "already_open",
        reason: null,
        reason_text: hit.created
          ? (dryRun
              ? "this rule's condition is true right now. Nothing was written — this was a dry run."
              : "this rule's condition is true, and an alert was written.")
          : "this rule's condition is true, and an alert for it is already open. Nothing was added.",
        /* NO ALERT ID ON A DRY RUN. The row the preview created was rolled back
           and its id names nothing — handing it to a screen would give somebody
           an "acknowledge" button for an alert that does not exist. The title
           and the numbers are real, because the data they restate is real. */
        alert: {
          id: dryRun ? null : (hit.alert?.id ?? null),
          kind: hit.kind,
          severity: hit.alert?.severity ?? null,
          title: hit.alert?.title ?? null,
          figures: hit.alert ? figuresFor(hit.alert) : []
        }
      };
    }

    const skip = skippedBy.get(rule);
    if (skip) {
      const outcomeName = skip.reason === "condition_false"
        ? "no"
        : (skip.reason === "threshold_unset" ? "not_run" : "cannot_tell");
      return {
        ...base,
        outcome: outcomeName,
        reason: skip.reason,
        reason_text: reasonText(skip.reason),
        alert: null
      };
    }

    // Neither raised nor skipped: the store never looked at it.
    const reason = base.configured ? "rule_disabled" : "rule_not_configured";
    return { ...base, outcome: "not_run", reason, reason_text: reasonText(reason), alert: null };
  });
}

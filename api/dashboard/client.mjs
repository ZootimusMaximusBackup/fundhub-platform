// GET /api/dashboard/client?id=<uuid>
// Read-only closer dashboard — full detail for one client.
// Returns the client row + related transactions[], crs_results[], messages[], tasks[].
// No writes. SELECT only. ESM. Mirrors api/health.mjs style.
import { db } from "../../src/db.mjs";
import { clientDetailExtras } from "../../src/http/client-detail.mjs";
import { redact, isUuid, requireRole, ROLE_SETS, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireDashboardAccess } from "../../src/http/dashboard-auth.mjs";
import { resolvePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { AUTH_UNAVAILABLE } from "../../src/http/middleware/requireAuth.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { requireSessionOrg } from "../../src/http/session-org.mjs";
import { safeError } from "../../src/http/health.mjs";
import { getActiveCaseForClient } from "../../src/inquiry-ops/cases.mjs";
import { consentStatus } from "../../src/consent/index.mjs";
import { deriveNextAction, sanitizeBlockerLabels } from "../../src/fulfillment/next-action.mjs";
import { gatherDetailSignals } from "../../src/fulfillment/read-signals.mjs";

/* Demo rows are shown on the page as they always were, but they never drive a
   derived answer. Only an explicit true counts as demo, so a NULL or a missing
   column leaves a row in — a real row wrongly dropped is worse than a demo row
   wrongly kept, and the demo seed always sets the flag. */
function realOnly(rows) {
  return Array.isArray(rows) ? rows.filter((r) => !(r && r.is_demo === true)) : [];
}

export default async function handler(req, res) {
  // A signed-in client (or any non-staff principal) is refused here. Do this
  // before requireDashboardAccess: that gate only sees staff tokens, so an
  // account token used to look unsigned-in (401). No-token callers still fall
  // through so the DASHBOARD_SECRET header fallback keeps working.
  const principal = await resolvePrincipal(req, { db });
  if (principal === AUTH_UNAVAILABLE) {
    return res.status(503).json({ ok: false, error: "auth_unavailable", db: "down" });
  }
  if (principal && principal.kind !== "staff") {
    return res.status(403).json({
      ok: false,
      error: "forbidden",
      message: "this endpoint serves staff"
    });
  }

  // Staff session first; the DASHBOARD_SECRET gate stays as the fallback until
  // cutover, so existing links keep working while staff accounts roll out.
  const staff = await requireDashboardAccess(req, res, { db });
  if (!staff) return;
  /* Same gap as api/dashboard/clients.mjs, and worse here: this response carries
     phone, message bodies, and the consent / do-not-contact flags for a named
     person. A session alone was enough, so role='partner' — an external
     white-label operator — could read all of it. ROLE_SETS.STAFF excludes
     'partner' and denies unknown roles by default.
     `true` is the DASHBOARD_SECRET fallback caller, which has no role to check. */
  if (staff !== true && !requireRole(res, staff, ROLE_SETS.STAFF)) return;

  // Org from the session ONLY. A shared-secret caller has no org — refuse rather
  // than open every company's client book. Confirmed P0 (2026-08-04): this
  // endpoint used to SELECT FROM clients WHERE id = $1 with no org filter, so
  // any staff who knew a UUID could read another company's file.
  const orgId = requireSessionOrg(res, staff);
  if (!orgId) return;

  const { id } = req.query ?? {};
  if (!id) return res.status(400).json({ ok: false, error: "?id= required" });
  // A malformed id is a bad request, not a server fault. Without this the seven
  // queries below all fail on SQLSTATE 22P02 and the screen was told the whole
  // backend was unreachable.
  if (!isUuid(id)) return res.status(400).json({ ok: false, error: "invalid_id" });

  // 404 (not 403) for cross-org — same oracle defence as requireClientInOrg.
  if (!await requireClientInOrg(res, db, staff, id)) return;

  try {
    const [clientRes, txRes, crsRes, msgRes, taskRes, roundRes, invRes, bizRes] = await Promise.all([
      db.query(
        `SELECT id, org_id, first_name, last_name, email, phone,
                outcome_tier, funded, funded_amount, days_to_fund,
                channel_source, tags, pipeline_ids,
                dnd_sms, dnd_email, dnd_voice, consent_sms,
                custom_fields, created_at, updated_at
         FROM clients WHERE id = $1 AND org_id = $2`,
        [id, orgId]
      ),
      db.query(
        `SELECT id, product_name, amount_paid, status, provider, provider_ref, created_at
         FROM transactions WHERE client_id = $1 AND org_id = $2 ORDER BY created_at DESC`,
        [id, orgId]
      ),
      db.query(
        `SELECT id, outcome_tier, result, created_at
         FROM crs_results WHERE client_id = $1 AND org_id = $2 ORDER BY created_at DESC`,
        [id, orgId]
      ),
      db.query(
        `SELECT id, direction, channel, template_key, rendered_body,
                provider, status, created_at
         FROM messages WHERE client_id = $1 AND org_id = $2
         ORDER BY created_at DESC LIMIT 100`,
        [id, orgId]
      ),
      db.query(
        `SELECT id, assignee_role, assignee_staff_id, title, body, due_at, done,
                source_workflow, created_at, is_demo
         FROM tasks WHERE client_id = $1 AND org_id = $2 ORDER BY created_at DESC`,
        [id, orgId]
      ),
      db.query(
        `SELECT id, round_number, status, product, submitted_amount, approved_amount,
                funded_amount, hold_reason, conditions, created_at, is_demo
         FROM funding_rounds WHERE client_id = $1 AND org_id = $2
         ORDER BY round_number DESC`,
        [id, orgId]
      ),
      db.query(
        `SELECT invoice_id AS id, status, currency, amount_due, amount_paid,
                balance_due, due_at, paid_at, created_at
         FROM v_invoice_balance WHERE client_id = $1 AND org_id = $2
         ORDER BY created_at DESC`,
        [id, orgId]
      ),
      db.query(
        `SELECT name, age_months, entity_data
           FROM businesses
          WHERE client_id = $1 AND org_id = $2
          ORDER BY updated_at DESC
          LIMIT 5`,
        [id, orgId]
      )
    ]);

    if (!clientRes.rows.length) {
      return res.status(404).json({ ok: false, error: "client not found" });
    }

    const client = clientRes.rows[0];
    const extras = clientDetailExtras({
      client,
      crsResults: crsRes.rows,
      tasks: taskRes.rows,
      fundingRounds: roundRes.rows,
      invoices: invRes.rows,
      businesses: bizRes.rows
    });

    // Active inquiry-removal case for the control panel status tile.
    // Table may be absent before migration — never break the dashboard.
    let inquiry_removal_case = null;
    try {
      inquiry_removal_case = await getActiveCaseForClient(db, {
        orgId,
        clientId: id
      });
    } catch (_) {
      inquiry_removal_case = null;
    }

    /* FULFILLMENT — what should someone do about this client next.
       READ ONLY, and DELIBERATELY OPTIONAL. Everything below is wrapped so that
       any failure — a derivation error, a table that is not there yet, a
       consent read that times out — returns this endpoint's response EXACTLY as
       it was before this block existed. The three new keys are ABSENT on
       failure, never blank and never a guess, so today's display survives.

       Nearly every signal is already in hand: the client row carries
       custom_fields, tags and outcome_tier; taskRes, roundRes and the active
       inquiry case are already loaded; open_blockers comes from
       clientDetailExtras. Only consent, the demo-filtered credit count, the
       identity packet, the dispute rows and the funding card need reading, and
       gatherDetailSignals() does all five in one parallel round.

       consentStatus() is passed in rather than called there so this endpoint
       uses the SAME function src/finance/soft-pulls.mjs:306-314 gates the pull
       on. The screen and the button cannot disagree.

       GATE A, AT THE SOURCE. This endpoint also returns the RAW open_blockers
       array from clientDetailExtras, and the client control panel paints that
       array directly — in the pre-existing Blockers panel, and again in the new
       control block when no derivation arrives. Both printed the task title as
       written, so a client with no recorded permission had one panel saying
       "Funding intake — pull CRS" while the panel below it said "waiting on
       written permission". Relabelling per panel failed three times.

       So the RELABEL HAPPENS HERE, ONCE, on the array this endpoint emits, and
       the derivation is handed the already-safe array. Every consumer — both
       panels, the pipeline lens, and anything built later — gets the safe label
       without having to know it should ask. sanitizeBlockerLabels() is
       idempotent and never throws; its header carries the rule. */
    let fulfillment = null;
    /* Fail closed. Until the consent read comes back, this client's written
       permission is UNCHECKED, so anything failing below still ships the safe
       label rather than the raw one. */
    let open_blockers = sanitizeBlockerLabels(extras.open_blockers, { consentValid: null });
    try {
      const gathered = await gatherDetailSignals(db, { orgId, clientId: id, consentStatus });
      /* true / false / null, where null means the consent read failed. Same
         three-state rule the derivation applies to this signal: anything that
         is not the shape consentStatus() returns is "we did not ask", not "no". */
      const consentValid =
        gathered && gathered.consent && typeof gathered.consent.valid === "boolean"
          ? gathered.consent.valid
          : null;
      open_blockers = sanitizeBlockerLabels(extras.open_blockers, { consentValid });
      fulfillment = deriveNextAction({
        ...gathered,
        custom_fields:  client.custom_fields,
        tags:           client.tags,
        outcome_tier:   client.outcome_tier,
        // getActiveCaseForClient already returns ACTIVE cases only.
        inquiry_cases:  inquiry_removal_case ? [inquiry_removal_case] : [],
        /* DEMO ROWS NEVER DRIVE A DERIVED ANSWER.
           The list path already excludes them in SQL (src/fulfillment/read-signals.mjs,
           OPEN_TASKS_SQL and ROUNDS_SQL). These two queries are pre-existing and feed
           the rest of today's page, so they are left exactly as they are and the demo
           rows are dropped here instead — an adversary found a real client carrying a
           demo funding round, and the new block printed "Approved $99,999" for it while
           the lens correctly showed nothing. Filtered here, both surfaces agree. */
        tasks:          realOnly(taskRes.rows),
        funding_rounds: realOnly(roundRes.rows),
        open_blockers
      });
    } catch (err) {
      console.warn("[fulfillment] next action unavailable for client detail:", err && err.message);
      fulfillment = null;
    }

    res.status(200).json(redact({
      ok: true,
      client,
      transactions:  txRes.rows,
      crs_results:   crsRes.rows,
      messages:      msgRes.rows,
      tasks:         taskRes.rows,
      funding_rounds: roundRes.rows,
      invoices:      invRes.rows,
      inquiry_removal_case,
      // Derived, never stored — see src/http/client-detail.mjs for why each of
      // these explains rather than recomputes.
      ...extras,
      /* AFTER ...extras on purpose — this replaces the raw open_blockers that
         spread carries. Same rows, same ids, same details; only a pull-credit
         label on a client without established permission is rewritten, and the
         words on the record survive on `recorded_label`. See the Gate A block
         above. */
      open_blockers,
      /* Derived, never stored. Absent entirely when the derivation could not
         run — see the block above. `next_action_degraded` true means one signal
         could not be read, so the screen should fall back to today's display
         rather than trust a partial answer. */
      ...(fulfillment ? {
        next_action:          fulfillment.next_action,
        active_blockers:      fulfillment.active_blockers,
        funding_round:        fulfillment.funding_round,
        next_action_degraded: fulfillment.degraded
      } : {})
    }));
  } catch (err) {
    if (CLIENT_DATA_ERRORS.has(err && err.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    // err.message can quote the DSN on a connection failure — scrub it the same
    // way health.mjs does rather than handing a host and password to the client.
    res.status(500).json({ ok: false, error: safeError(err) });
  }
}

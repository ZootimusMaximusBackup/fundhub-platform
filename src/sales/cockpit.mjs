// Closer Dashboard live-call payload — everything needed for one client on one call.
// Assembles existing reads; does not invent credit or money numbers.

import { countUnlogged, listUnloggedCalls } from "./call-outcomes.mjs";
import { formatUsdFromCents, monthWindow } from "./metrics.mjs";
import { toCents } from "../commissions/money.mjs";
import { matchForClient } from "../lenders/store.mjs";
import { triMerge } from "../http/client-detail.mjs";
import { toBureaus } from "../underwrite/adapter.mjs";
import { computeUnderwrite } from "../underwrite/engine.mjs";
import { applyStackedBusinessFunding } from "../underwrite/business-funding.mjs";

function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Number(n);
}

/**
 * buildCockpit(db, { orgId, staffId, clientId, now })
 */
export async function buildCockpit(db, { orgId, staffId, clientId, now = new Date() } = {}) {
  if (!orgId || !staffId || !clientId) {
    throw new TypeError("buildCockpit: orgId, staffId, clientId required");
  }

  const clientRes = await db.query(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.channel_source,
            c.funded, c.funded_amount, c.outcome_tier, c.custom_fields, c.tags,
            b.name AS business_name, b.age_months,
            cf.utm_source, cf.utm_campaign, cf.utm_medium, cf.cf_setter_user_id
       FROM clients c
       LEFT JOIN businesses b ON b.client_id = c.id AND b.org_id = c.org_id
       LEFT JOIN client_custom_fields cf ON cf.client_id = c.id AND cf.org_id = c.org_id
      WHERE c.id = $1 AND c.org_id = $2`,
    [clientId, orgId]
  );
  const client = clientRes.rows[0];
  if (!client) return null;

  const window = monthWindow(now);

  const [
    shift,
    kpis,
    unlogged,
    upNext,
    goneQuiet,
    card,
    crs,
    tradelines,
    liabilities,
    businesses,
    underwriteHint,
    conv,
    messages,
    lenders,
    apps,
    recentTx,
    templatesSent
  ] = await Promise.all([
    db.query(
      `SELECT id, started_at FROM shifts
        WHERE org_id = $1 AND staff_id = $2 AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1`,
      [orgId, staffId]
    ),
    db.query(
      `SELECT COALESCE(SUM(cash_collected_cents), 0)::bigint AS cash_cents,
              count(*) FILTER (WHERE outcome = 'deposit')::int AS deposits,
              count(*) FILTER (WHERE outcome <> 'no_show')::int AS held,
              count(*) FILTER (WHERE outcome = 'no_show')::int AS no_shows
         FROM call_outcomes
        WHERE org_id = $1 AND staff_id = $2
          AND logged_at >= $3 AND logged_at < $4`,
      [orgId, staffId, window.start.toISOString(), window.end.toISOString()]
    ),
    countUnlogged(db, { orgId, staffId }),
    upcomingCalls(db, { orgId, staffId, excludeClientId: clientId }),
    quietClients(db, { orgId, staffId }),
    db.query(
      `SELECT ps.key AS stage_key, ps.name AS stage_name, p.key AS pipeline_key
         FROM cards card
         JOIN pipeline_stages ps ON ps.id = card.stage_id
         JOIN pipelines p ON p.id = card.pipeline_id
        WHERE card.client_id = $1 AND card.org_id = $2
        ORDER BY card.updated_at DESC LIMIT 1`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT result, created_at FROM crs_results
        WHERE client_id = $1 AND org_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT * FROM tradelines
        WHERE client_id = $1 AND org_id = $2
        ORDER BY apr ASC NULLS LAST, lender ASC`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT * FROM card_liabilities
        WHERE client_id = $1 AND org_id = $2
        ORDER BY as_of DESC`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT age_months FROM businesses
        WHERE client_id = $1 AND org_id = $2
        ORDER BY created_at ASC`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT id FROM funding_rounds
        WHERE client_id = $1 AND org_id = $2
        ORDER BY round_number DESC LIMIT 1`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT id, channel, summary, sentiment, last_pulse_at, updated_at
         FROM conversations
        WHERE client_id = $1 AND org_id = $2
        ORDER BY COALESCE(last_pulse_at, updated_at) DESC NULLS LAST
        LIMIT 3`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT direction, channel, rendered_body, template_key, created_at, status
         FROM messages
        WHERE client_id = $1 AND org_id = $2
        ORDER BY created_at DESC LIMIT 20`,
      [clientId, orgId]
    ),
    // Lender matches — computed, not a table.
    matchForClient(db, { orgId, clientId })
      .then((r) => r || { matches: [], match_count: 0 })
      .catch(() => ({ matches: [], match_count: 0 })),
    db.query(
      `SELECT a.id, a.status, a.lender_name, a.bank, a.approved_amount, a.requested_amount, a.created_at
         FROM applications a
        WHERE a.org_id = $2
          AND (a.client_id = $1 OR a.funding_round_id IN (
                SELECT id FROM funding_rounds WHERE client_id = $1 AND org_id = $2
              ))
        ORDER BY a.created_at DESC LIMIT 10`,
      [clientId, orgId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT id, product_name, amount_paid, status, created_at
         FROM transactions
        WHERE client_id = $1 AND org_id = $2
          AND status IN ('paid','succeeded','complete','completed')
        ORDER BY created_at DESC LIMIT 5`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT DISTINCT template_key FROM messages
        WHERE client_id = $1 AND org_id = $2
          AND template_key IS NOT NULL
        ORDER BY template_key
        LIMIT 20`,
      [clientId, orgId]
    )
  ]);

  const kpi = kpis.rows[0] || {};
  const held = Number(kpi.held || 0);
  const deposits = Number(kpi.deposits || 0);
  const staffRow = await db.query(`SELECT name FROM staff WHERE id = $1 AND org_id = $2`, [staffId, orgId]);

  const credit = summarizeCrs(crs.rows[0]);
  const underwriteAdapter = toBureaus({
    tradelines: tradelines.rows,
    liabilities: liabilities.rows,
    crsResults: crs.rows,
    customFields: client.custom_fields || {},
    businesses: businesses.rows
  });
  const underwriteData = applyStackedBusinessFunding(
    computeUnderwrite(
      underwriteAdapter.bureaus,
      underwriteAdapter.businessAgeMonths
    ),
    underwriteAdapter.businessAges
  );
  const precall = buildPrecall({
    client,
    conversations: conv.rows,
    messages: messages.rows
  });

  const depositProduct = recentTx.rows[0]
    ? {
        transaction_id: recentTx.rows[0].id,
        amount_cents: toCents(recentTx.rows[0].amount_paid),
        amount_display: formatUsdFromCents(toCents(recentTx.rows[0].amount_paid)),
        product_name: recentTx.rows[0].product_name,
        created_at: recentTx.rows[0].created_at
      }
    : null;

  return {
    staff: {
      id: staffId,
      name: staffRow.rows[0]?.name || null,
      shift: shift.rows[0]
        ? {
            on_shift: true,
            started_at: shift.rows[0].started_at,
            elapsed_ms: Math.max(0, now.getTime() - new Date(shift.rows[0].started_at).getTime())
          }
        : { on_shift: false, reason: "No open shift" }
    },
    kpis: {
      cash_today_cents: await todayCash(db, { orgId, staffId, now }),
      cash_month_cents: Number(kpi.cash_cents || 0),
      cash_month_display: formatUsdFromCents(kpi.cash_cents),
      deposits,
      calls_held: held,
      no_shows: Number(kpi.no_shows || 0),
      close_rate: held ? deposits / held : null,
      unlogged,
      commission_mtd: null,
      commission_reason: "Open My numbers"
    },
    client: {
      id: client.id,
      name: [client.first_name, client.last_name].filter(Boolean).join(" ") || client.email || "Client",
      business_name: client.business_name,
      city: null,
      state: null,
      location_reason: "City/state are not columns on client_custom_fields — address lives in pii_identity when captured",
      age_months: client.age_months,
      channel_source: client.channel_source,
      utm_campaign: client.utm_campaign,
      utm_source: client.utm_source,
      setter_key: client.cf_setter_user_id,
      tags: client.tags || [],
      funded: client.funded,
      pipeline: card.rows[0] || null
    },
    credit,
    underwrite: {
      ...underwriteData,
      funding_round_id: underwriteHint.rows[0]?.id || null,
      matched_lenders: Number(lenders.match_count || lenders.matches?.length || 0),
      lenders: lenders.matches || [],
      lenders_reason: (lenders.match_count || 0) === 0
        ? "No lenders matched (empty lenders table or filters excluded all)"
        : null,
      applications: apps.rows
    },
    deal: {
      latest_payment: depositProduct,
      success_fee_percent: 0.10,
      success_fee_note: "Fee percent from funding_closeout default (10%). Exact fee appears after a round closeout."
    },
    precall,
    templates_sent: templatesSent.rows.map((r) => r.template_key),
    join_url: (await db.query(
      `SELECT meeting_url FROM tasks
        WHERE org_id = $1 AND client_id = $2
          AND meeting_url IS NOT NULL AND btrim(meeting_url) <> ''
        ORDER BY due_at DESC NULLS LAST
        LIMIT 1`,
      [orgId, clientId]
    )).rows[0]?.meeting_url || null,
    up_next: upNext,
    gone_quiet: goneQuiet,
    compliance_checklist: {
      items: [
        { id: "recorded", label: "Call is recorded" },
        { id: "personal_guarantee", label: "Personal guarantee" },
        { id: "month14", label: "Month-14 cliff" },
        { id: "bank_decides", label: "Bank decides, not us" },
        { id: "incorporation_verified", label: "Incorporation date verified — do not take their word" }
      ],
      never: ["guaranteed", "won't affect credit", "we have relationships", "0% forever"],
      recording_metrics: {
        available: false,
        reason: "Call recording and transcription do not exist yet"
      }
    },
    dispositions: {
      outcomes: ["deposit", "downsell", "callback", "no_show", "not_a_fit"],
      beliefs: ["pain", "doubt", "cost", "desire", "money", "support", "trust"],
      cash_note: "Cash, duration, recording and transcript log themselves — cash from the payment record only"
    }
  };
}

async function todayCash(db, { orgId, staffId, now }) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const r = await db.query(
    `SELECT COALESCE(SUM(cash_collected_cents), 0)::bigint AS cents,
            count(*) FILTER (WHERE outcome = 'deposit')::int AS deposits
       FROM call_outcomes
      WHERE org_id = $1 AND staff_id = $2 AND logged_at >= $3`,
    [orgId, staffId, start.toISOString()]
  );
  return {
    cents: Number(r.rows[0]?.cents || 0),
    display: formatUsdFromCents(r.rows[0]?.cents),
    deposits: Number(r.rows[0]?.deposits || 0)
  };
}

function summarizeCrs(row) {
  if (!row) {
    return {
      available: false,
      reason: "No crs_results row for this client yet",
      pulled_at: null
    };
  }
  const result = row.result || {};
  // Same bureau FICO extraction as Client Control Panel (triMerge) — raw
  // CRS scores use ex/eq/tu; the cockpit paint path reads experian/equifax/transunion.
  const merge = triMerge([row]);
  const scores = {
    experian: merge.experian,
    equifax: merge.equifax,
    transunion: merge.transunion
  };
  const signals = result.consumerSignals || result.consumer_signals || {};
  const utilPct = result.utilization ?? result.util
    ?? signals.utilization?.pct ?? signals.utilization?.percent
    ?? null;
  const inquiriesList = Array.isArray(result.inquiries) ? result.inquiries : null;
  return {
    available: true,
    pulled_at: merge.asOf || row.created_at,
    raw_keys: Object.keys(result).slice(0, 40),
    scores,
    utilization: money(utilPct),
    inquiries_6mo: money(
      result.inquiries_6mo
      ?? (inquiriesList ? inquiriesList.length : null)
      ?? (typeof result.inquiries === "number" ? result.inquiries : null)
    ),
    derogatories: result.derogatories ?? result.derogs ?? null,
    note: "Scores come from triMerge over the stored CRS payload; UnderwriteIQ projections sit beside this block in the same closer-call response."
  };
}

function buildPrecall({ client, conversations, messages }) {
  const inbound = messages.filter((m) => m.direction === "inbound");
  const last = messages[0];
  const summary = conversations[0]?.summary
    || (inbound[0]?.rendered_body ? String(inbound[0].rendered_body).slice(0, 280) : null);
  const cf = client.custom_fields || {};
  return {
    conversation_count: messages.length,
    summary: summary || "No conversation summary on file yet.",
    sentiment: conversations[0]?.sentiment || null,
    wants: cf.funding_amount_requested || cf.amount_requested || cf.desired_funding || null,
    purpose: cf.use_of_funds || cf.funding_purpose || null,
    guessed_fico: cf.estimated_fico || cf.guessed_fico || null,
    last_message_at: last?.created_at || null,
    setter_key: client.cf_setter_user_id,
    lead_source: client.utm_campaign || client.utm_source || client.channel_source || null
  };
}

async function upcomingCalls(db, { orgId, staffId, excludeClientId }) {
  const r = await db.query(
    `SELECT t.id AS task_id, t.client_id, t.due_at, t.meeting_url, t.title,
            COALESCE(NULLIF(trim(c.first_name || ' ' || c.last_name), ''), c.email, 'Client') AS name
       FROM tasks t
       LEFT JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
       LEFT JOIN call_outcomes o ON o.task_id = t.id
      WHERE t.org_id = $1
        AND t.assignee_role = 'closer'
        AND (t.assignee_staff_id = $2 OR t.assignee_staff_id IS NULL)
        AND t.due_at IS NOT NULL AND t.due_at >= now()
        AND o.id IS NULL
        AND ($3::uuid IS NULL OR t.client_id IS DISTINCT FROM $3)
      ORDER BY t.due_at ASC
      LIMIT 5`,
    [orgId, staffId, excludeClientId]
  );
  return r.rows;
}

async function quietClients(db, { orgId, staffId }) {
  const r = await listUnloggedCalls(db, { orgId, staffId, limit: 5 });
  // Also surface deposit-not-funded quiet — reuse cold query lightly
  const cold = await db.query(
    `SELECT c.id AS client_id,
            COALESCE(NULLIF(trim(c.first_name || ' ' || c.last_name), ''), 'Client') AS name,
            EXTRACT(DAY FROM (now() - o.logged_at))::int AS quiet_days,
            o.cash_collected_cents
       FROM call_outcomes o
       JOIN clients c ON c.id = o.client_id
      WHERE o.org_id = $1 AND o.staff_id = $2 AND o.outcome = 'deposit'
        AND c.funded IS NOT TRUE
        AND o.logged_at < now() - interval '7 days'
      ORDER BY o.logged_at ASC
      LIMIT 5`,
    [orgId, staffId]
  ).catch(() => ({ rows: [] }));
  return {
    unlogged: r,
    quiet_deposits: cold.rows
  };
}

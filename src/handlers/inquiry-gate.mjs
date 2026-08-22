// Inquiry Gate — case creation trigger between onboarding and every funding round.
//
// COMPLIANCE REVIEW REQUIRED: dispute letter drafts + doc gate for identity packet.
//
// Triggers:
//   deposit.paid   — pre-funding cleanup (always fires)
//   round.closeout — between-round cleanup (NOT round.funded).
//                    Money-chain per-round closeout still raises the gate.
//                    Staff Closed-column / engagement-complete closeout does not
//                    (N-04 still listens on that payload).
//
// One case per bureau with items. Nothing sends from here — draft only.

import { on } from "../events/registry.mjs";
import { emit } from "../events/bus.mjs";
import { resolveClient } from "./client-lifecycle.mjs";
import { createCase, updateCase, CASE_STATUSES } from "../inquiry-ops/cases.mjs";
import { createPrep } from "../inquiry-ops/prep.mjs";
import { loadDisputables, BUREAU_KEYS } from "../inquiry-ops/extract-disputables.mjs";
import { renderLetterDraft } from "../inquiry-ops/letter-draft.mjs";
import { evaluateDocGate } from "../inquiry-ops/doc-gate.mjs";
import { moveCardToStage } from "../workflows/cards.mjs";

const ACTIVE = new Set(["Queued", "Scheduled", "In Progress", "Escalated", "Blocked"]);

function fundingRoundIdFrom(event) {
  const p = event.payload || {};
  return p.fundingRoundId || p.funding_round_id || null;
}

async function loadClient(db, clientId) {
  const r = await db.query(
    `SELECT id, org_id, first_name, last_name, email, phone, custom_fields
       FROM clients WHERE id = $1::uuid`,
    [clientId]
  );
  return r.rows[0] || null;
}

async function findActiveCase(db, { orgId, clientId, fundingRoundId, bureau }) {
  const r = await db.query(
    `SELECT *
       FROM inquiry_removal_cases
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND selected_bureaus_raw = $3
        AND case_status::text = ANY($4::text[])
        AND funding_round_id IS NOT DISTINCT FROM $5::uuid
      ORDER BY requested_at DESC
      LIMIT 1`,
    [orgId, clientId, bureau, [...ACTIVE], fundingRoundId]
  );
  return r.rows[0] || null;
}

async function stageItems(db, { orgId, clientId, items }) {
  for (const item of items) {
    const existing = await db.query(
      `SELECT id FROM inquiry_prep
        WHERE org_id = $1::uuid
          AND client_id = $2::uuid
          AND bureau = $3
          AND inquiry_name = $4
          AND prep_state IN ('staging', 'Ready for Cleanup')
        LIMIT 1`,
      [orgId, clientId, item.bureau, item.inquiry_name]
    );
    if (existing.rows[0]) continue;
    await createPrep(db, {
      orgId,
      row: {
        client_id: clientId,
        prep_state: "staging",
        bureau: item.bureau,
        inquiry_name: item.inquiry_name,
        inquiry_date: item.inquiry_date || null
      }
    });
  }
}

async function upsertBureauCase(db, {
  orgId,
  clientId,
  fundingRoundId,
  bureau,
  bucket,
  client,
  packet
}) {
  const caseStatus = packet.complete ? "Queued" : "Blocked";
  const letterHtml = renderLetterDraft({
    client,
    bureau,
    inquiries: bucket.inquiries,
    pii: bucket.pii
  });
  const openCount = bucket.openCount;
  const existing = await findActiveCase(db, {
    orgId, clientId, fundingRoundId, bureau
  });

  let row;
  if (existing) {
    await updateCase(db, {
      orgId,
      id: existing.id,
      patch: {
        case_status: CASE_STATUSES.includes(caseStatus) ? caseStatus : existing.case_status,
        open_inquiry_count: openCount,
        selected_bureaus_raw: bureau,
        funding_round_id: fundingRoundId
      }
    });
    const u = await db.query(
      `UPDATE inquiry_removal_cases
          SET letter_draft_html = $2,
              open_inquiry_count = $3,
              case_status = $4::inquiry_case_status,
              funding_round_id = COALESCE($5::uuid, funding_round_id),
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [existing.id, letterHtml, openCount, caseStatus, fundingRoundId]
    );
    row = u.rows[0];
  } else {
    const caseKey = [
      "IG",
      String(clientId).replace(/-/g, "").slice(0, 8),
      bureau,
      fundingRoundId ? String(fundingRoundId).replace(/-/g, "").slice(0, 8) : "pre"
    ].join("-");

    row = await createCase(db, {
      orgId,
      row: {
        client_id: clientId,
        funding_round_id: fundingRoundId,
        case_id: caseKey,
        case_status: caseStatus,
        selected_bureaus_raw: bureau,
        open_inquiry_count: openCount,
        request_source: "inquiry_gate",
        requested_by: "inquiry-gate"
      }
    });
    await db.query(
      `UPDATE inquiry_removal_cases
          SET letter_draft_html = $2
        WHERE id = $1`,
      [row.id, letterHtml]
    );
    row = { ...row, letter_draft_html: letterHtml };
  }

  await stageItems(db, { orgId, clientId, items: bucket.items });
  return row;
}

/**
 * Core trigger body — exported for tests.
 */
export async function onInquiryGateTrigger(event, db) {
  const orgId = event.orgId;
  const clientId = event.clientId || (await resolveClient(db, event));
  if (!orgId || !clientId) {
    return { done: false, reason: "missing_org_or_client" };
  }

  const fundingRoundId = fundingRoundIdFrom(event);
  const client = await loadClient(db, clientId);
  if (!client) return { done: false, reason: "client_not_found" };

  const disputables = await loadDisputables(db, { orgId, clientId });
  if (!disputables.bureausWithItems.length) {
    await emit(
      db,
      "inquiry.gate.clear",
      { clientId, fundingRoundId, reason: "zero_items" },
      {
        orgId,
        clientId,
        idempotencyKey: `inquiry.gate.clear:${clientId}:${fundingRoundId || "pre"}:${event.id || "x"}`
      }
    );
    return { done: true, cleared: true, cases: [] };
  }

  const allItems = disputables.bureausWithItems.flatMap(
    (b) => disputables.bureaus[b].items
  );
  const packet = await evaluateDocGate(db, {
    orgId,
    clientId,
    items: allItems
  });

  const cases = [];
  for (const bureau of BUREAU_KEYS) {
    const bucket = disputables.bureaus[bureau];
    if (!bucket.openCount) continue;
    const row = await upsertBureauCase(db, {
      orgId,
      clientId,
      fundingRoundId,
      bureau,
      bucket,
      client,
      packet
    });
    cases.push(row);
  }

  // Pipeline: created → requested; then doc-gate stage.
  await moveCardToStage(db, {
    orgId,
    clientId,
    pipelineKey: "inquiry_removal",
    stageKey: "requested"
  });
  if (!packet.complete) {
    await moveCardToStage(db, {
      orgId,
      clientId,
      pipelineKey: "inquiry_removal",
      stageKey: "awaiting_documents"
    });
    await emit(
      db,
      "inquiry.docs.needed",
      {
        clientId,
        missing: packet.missing,
        caseIds: cases.map((c) => c.id)
      },
      {
        orgId,
        clientId,
        idempotencyKey: `inquiry.docs.needed:${clientId}:${fundingRoundId || "pre"}:${event.id || "x"}`
      }
    );
  } else {
    await moveCardToStage(db, {
      orgId,
      clientId,
      pipelineKey: "inquiry_removal",
      stageKey: "specialist_assigned"
    });
  }

  const bureaus = cases.map((c) => c.selected_bureaus_raw);
  await emit(
    db,
    "inquiry.gate.raised",
    { clientId, bureaus, fundingRoundId, caseIds: cases.map((c) => c.id) },
    {
      orgId,
      clientId,
      idempotencyKey: `inquiry.gate.raised:${clientId}:${fundingRoundId || "pre"}:${bureaus.sort().join(",")}:${event.id || "x"}`
    }
  );

  return {
    done: true,
    cleared: false,
    cases,
    bureaus,
    packetComplete: packet.complete
  };
}

export async function onDepositPaidGate(event, db) {
  return onInquiryGateTrigger(event, db);
}

function isEngagementCompleteCloseout(payload = {}) {
  return payload.stage === "closed" || payload.engagementComplete === true;
}

export async function onRoundCloseoutGate(event, db) {
  if (isEngagementCompleteCloseout(event.payload || {})) {
    return { done: false, reason: "engagement_complete" };
  }
  return onInquiryGateTrigger(event, db);
}

export function register() {
  on("deposit.paid", onDepositPaidGate);
  on("round.closeout", onRoundCloseoutGate);
}

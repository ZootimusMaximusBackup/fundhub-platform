// C. INQUIRY REMOVAL — call_state through all 11 states; business status never
// changes as a side effect of call_state transitions.

import { emit } from "../../events/bus.mjs";
import { CALL_STATES } from "../fixtures.mjs";
import { insertClient } from "../insert-client.mjs";
import { createCase, updateCase } from "../../inquiry-ops/cases.mjs";
import { handle as c02 } from "../../workflows/c-02-inquiry-created.mjs";
import { handle as c03 } from "../../workflows/c-03-inquiry-removed-resume-or-hold.mjs";

function stepFake() {
  return { async run(_n, fn) { return fn(); }, async sleep() {}, async sendEvent() {} };
}

export async function runInquiryJourney(db, ctx, collector) {
  const section = "DATA";
  const journey = "INQUIRY_REMOVAL";
  const role = "inquiry_specialist";
  const steps = [];
  const email = `${ctx.mark}.inq.${ctx.stamp}@verify.local`;
  const specialist = ctx.staffByRole.inquiry_specialist;

  const client = await insertClient(db, {
    orgId: ctx.orgId, email, firstName: "Verify", lastName: "Inquiry",
    phone: "+15550100003"
  });

  // Create inquiry_log row
  let inquiry;
  try {
    inquiry = (await db.query(
      `INSERT INTO inquiry_log (
         org_id, client_id, bureau, inquiry, status, call_state, attempt_count
       ) VALUES ($1,$2,'EX','Hard inquiry — Verify Bank','open','not_started',0)
       RETURNING *`,
      [ctx.orgId, client.id]
    )).rows[0];
  } catch (err) {
    collector.fail({
      section, journey, role, id: "inq-log-insert",
      claim: "Can insert inquiry_log row",
      detail: String(err.message || err),
      file: "db/migrations/t140_inquiry_ops.sql"
    });
    return {
      note: {
        title: "C. Inquiry removal",
        usableToday: false,
        steps: [{ step: "inquiry_log insert", status: "FAIL", persisted: String(err.message || err) }],
        body: "Cannot create inquiry_log — inquiry ops unusable."
      },
      clientIds: [client.id],
      usableToday: false
    };
  }

  collector.pass({
    section, journey, role, id: "inq-logged",
    claim: "Inquiry logged with business status=open and call_state=not_started",
    actual: { id: inquiry.id, status: inquiry.status, call_state: inquiry.call_state }
  });
  steps.push({
    step: "Inquiry logged",
    status: "PASS",
    persisted: `id=${inquiry.id} status=${inquiry.status} call_state=${inquiry.call_state}`
  });

  // Case created
  let caseRow = null;
  try {
    caseRow = await createCase(db, {
      orgId: ctx.orgId,
      row: {
        client_id: client.id,
        status: "Queued",
        assigned_remover: specialist.id,
        open_inquiry_count: 1,
        master_call_state: "not_started"
      }
    });
  } catch (err) {
    collector.fail({
      section, journey, role, id: "inq-case",
      claim: "Inquiry removal case created",
      detail: String(err.message || err),
      file: "src/inquiry-ops/cases.mjs"
    });
  }
  if (caseRow?.id || caseRow?.case?.id) {
    const id = caseRow.id || caseRow.case.id;
    collector.pass({
      section, journey, role, id: "inq-case",
      claim: "Inquiry removal case created",
      actual: { id }
    });
    steps.push({ step: "Case created", status: "PASS", persisted: `case=${id}` });
  }

  await c02({
    event: {
      orgId: ctx.orgId, clientId: client.id, id: `evt-c02-${ctx.stamp}`,
      payload: { email, inquiryId: inquiry.id }
    },
    db, step: stepFake()
  }).catch(() => {});

  // Walk all 11 call_states — business status must stay open
  let statusBleed = false;
  for (const state of CALL_STATES) {
    await db.query(
      `UPDATE inquiry_log SET call_state = $2::inquiry_call_state, updated_at = now()
        WHERE id = $1`,
      [inquiry.id, state]
    );
    const row = (await db.query(
      `SELECT status, call_state FROM inquiry_log WHERE id = $1`, [inquiry.id]
    )).rows[0];
    if (row.status !== "open") {
      statusBleed = true;
      collector.fail({
        section, journey, role, id: `inq-bleed-${state}`,
        claim: `Business status stays open when call_state → ${state}`,
        detail: `status became ${row.status}`,
        file: "db/migrations/t140_inquiry_ops.sql",
        p0: false,
        expected: { status: "open" },
        actual: { status: row.status, call_state: row.call_state }
      });
    } else {
      collector.pass({
        section, journey, role, id: `inq-state-${state}`,
        claim: `call_state=${state} leaves business status=open`,
        actual: { status: row.status, call_state: row.call_state }
      });
    }
  }
  steps.push({
    step: "All 11 call_states without status bleed",
    status: statusBleed ? "FAIL" : "PASS",
    persisted: statusBleed ? "business status changed" : "status remained open"
  });

  // Explicit clear — then inquiry.removed
  await db.query(
    `UPDATE inquiry_log SET status = 'cleared', call_state = 'completed', updated_at = now()
      WHERE id = $1`,
    [inquiry.id]
  );
  const cleared = (await db.query(
    `SELECT status, call_state FROM inquiry_log WHERE id = $1`, [inquiry.id]
  )).rows[0];
  collector.assertEq({
    section, journey, role, id: "inq-cleared",
    claim: "Business status cleared only when explicitly set",
    expected: "cleared", actual: cleared.status,
    file: "api/inquiries.mjs"
  });

  await emit(db, "inquiry.removed", {
    email, inquiryId: inquiry.id, bureau: "EX", source: "inquiry_log"
  }, {
    orgId: ctx.orgId, clientId: client.id,
    idempotencyKey: `${ctx.mark}:inq-rm:${ctx.stamp}`
  });

  let c03Result = null;
  try {
    c03Result = await c03({
      event: {
        orgId: ctx.orgId, clientId: client.id, id: `evt-c03-${ctx.stamp}`,
        payload: { email, inquiryId: inquiry.id }
      },
      db, step: stepFake()
    });
    collector.pass({
      section, journey, role, id: "inq-c03",
      claim: "C-03 reacted to inquiry.removed",
      actual: c03Result
    });
  } catch (err) {
    collector.fail({
      section, journey, role, id: "inq-c03",
      claim: "C-03 reacted to inquiry.removed",
      detail: String(err.message || err),
      file: "src/workflows/c-03-inquiry-removed-resume-or-hold.mjs"
    });
  }
  steps.push({
    step: "cleared → inquiry.removed → C-03",
    status: c03Result ? "PASS" : "FAIL",
    persisted: JSON.stringify(c03Result || {})
  });

  const usableToday = !statusBleed && cleared.status === "cleared" && Boolean(c03Result);
  return {
    note: {
      title: "C. Inquiry removal",
      usableToday,
      steps,
      body: [
        `Inquiry ${inquiry.id}; case ${caseRow?.id || caseRow?.case?.id || "none"}`,
        `call_state machine: ${CALL_STATES.length} states exercised`,
        `Status bleed on call_state: ${statusBleed ? "YES — BAD" : "no"}`,
        usableToday
          ? "Operator verdict: YES for status separation; real Bland voice still credential-gated."
          : "Operator verdict: NO — status machine or C-03 reaction broken."
      ].join("\n")
    },
    clientIds: [client.id],
    usableToday
  };
}

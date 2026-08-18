// W-INB — inbound bureau-response / mail.response / docs.received / c-03.
// Findings only. THIS simulated client only. No live bureau. No mail vendor.
// Do not turn on INNGEST_EVENT_KEY. Never touch forbidden live file.
// Writes: this client only. No teardown.

import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-engine-2026-08-18-evidence/w-inb");
const CLIENT_ID = "41a3199f-1835-4ac8-91c0-d4f37bd92037";
const CRS_ID = "c1f83e6b-a624-4f28-a32a-531a530b3ad4";
const ORG_ID = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const INQUIRY_CASE_ID = "d1635579-eda9-4961-8ca8-50abe7151ecf";
const DOCUMENT_ID = "bf55375a-b4c7-48aa-8241-9b818bc60c82";
const FORBIDDEN = "9af65808-a619-4e65-ae91-239766a006b7";
const COMPARE = "8556bedc-46e1-4d85-b0cd-a24adfee1521";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
if (CLIENT_ID === FORBIDDEN) throw new Error("refused forbidden live id");

const inngestKeyWasPresent = !!(process.env.INNGEST_EVENT_KEY && String(process.env.INNGEST_EVENT_KEY).trim());
delete process.env.INNGEST_EVENT_KEY;

fs.mkdirSync(OUT, { recursive: true });

function write(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2));
}

function envPresent(name) {
  const raw = process.env[name];
  return { name, present: raw != null && String(raw).trim() !== "" };
}

function errShape(err) {
  return {
    name: err && err.name,
    message: String(err && err.message || err).slice(0, 400),
    code: err && err.code
  };
}

async function dumpClientSlice(db, label) {
  const client = (await db.query(
    `SELECT id, org_id, is_demo, outcome_tier,
            ghl_contact_id IS NOT NULL AS ghl_contact_id_present,
            tags, custom_fields, updated_at
       FROM clients WHERE id = $1`,
    [CLIENT_ID]
  )).rows[0] || null;

  const caseRow = (await db.query(
    `SELECT id, client_id, org_id, case_status, selected_bureaus_raw,
            request_source, is_demo, updated_at
       FROM inquiry_removal_cases WHERE id = $1`,
    [INQUIRY_CASE_ID]
  )).rows[0] || null;

  const doc = (await db.query(
    `SELECT id, client_id, org_id, kind, subtype, title, generated_at
       FROM documents WHERE id = $1`,
    [DOCUMENT_ID]
  )).rows[0] || null;

  const events = (await db.query(
    `SELECT id, name, client_id, idempotency_key, created_at
       FROM events
      WHERE client_id = $1
        AND name IN (
          'mail.response','docs.received','inquiry.removed',
          'repair.response.parsed','repair.parse.low_confidence',
          'inquiry.gate.raised','round.approved','message.queued'
        )
      ORDER BY created_at`,
    [CLIENT_ID]
  )).rows;

  const bankInbox = (await db.query(
    `SELECT id, org_id, client_id, classification, subject, created_at
       FROM bank_inbox WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT_ID]
  )).rows;

  const decisionLog = (await db.query(
    `SELECT id, org_id, client_id, case_id, decision, created_at
       FROM repair_decision_log WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT_ID]
  )).rows;

  const disputeCases = (await db.query(
    `SELECT id FROM dispute_cases WHERE client_id = $1`,
    [CLIENT_ID]
  )).rows;

  const tasks = (await db.query(
    `SELECT id, title, source_workflow, body, assignee_role, done, created_at
       FROM tasks WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT_ID]
  )).rows;

  const cards = (await db.query(
    `SELECT c.id, p.key AS pipeline_key, ps.key AS stage_key
       FROM cards c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
       LEFT JOIN pipeline_stages ps ON ps.id = c.stage_id
      WHERE c.client_id = $1
      ORDER BY c.created_at`,
    [CLIENT_ID]
  )).rows;

  const messages = (await db.query(
    `SELECT id, direction, channel, status, template_key, created_at
       FROM messages WHERE client_id = $1 ORDER BY created_at`,
    [CLIENT_ID]
  )).rows;

  const fundingRounds = (await db.query(
    `SELECT id, round_number, hold_reason FROM funding_rounds WHERE client_id = $1`,
    [CLIENT_ID]
  )).rows;

  return {
    label,
    client_id: CLIENT_ID,
    client: client && {
      id: client.id,
      org_id: client.org_id,
      is_demo: client.is_demo,
      outcome_tier: client.outcome_tier,
      ghl_contact_id_present: client.ghl_contact_id_present,
      tags: client.tags,
      custom_fields: client.custom_fields || {},
      updated_at: client.updated_at
    },
    inquiry_case: caseRow,
    document: doc,
    events,
    bank_inbox: bankInbox,
    repair_decision_log: decisionLog,
    dispute_cases: disputeCases,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      source_workflow: t.source_workflow,
      done: t.done,
      created_at: t.created_at
    })),
    cards,
    messages,
    funding_rounds: fundingRounds
  };
}

async function eventCounts(db, clientId) {
  return (await db.query(
    `SELECT name, count(*)::int AS n
       FROM events
      WHERE client_id = $1
        AND name IN ('mail.response','docs.received','inquiry.removed',
                     'repair.response.parsed','repair.parse.low_confidence')
      GROUP BY name
      ORDER BY name`,
    [clientId]
  )).rows;
}

async function main() {
  const { db, close } = await import("../../../../src/db.mjs");
  const { emit } = await import("../../../../src/events/bus.mjs");
  const { registerAll } = await import("../../../../src/register-all.mjs");
  const { getHandlers } = await import("../../../../src/events/registry.mjs");
  const { handleInboundResponse } = await import("../../../../src/metro2/inbound/handler.mjs");
  const { parseResponseText } = await import("../../../../src/metro2/inbound/parse-response.mjs");
  const { fakeStep } = await import("../../../../src/workflows/test-support.mjs");
  const f06 = await import("../../../../src/workflows/f-06-funding-conditions-missing-docs.mjs");
  const f09 = await import("../../../../src/workflows/f-09-funding-declined-no-path.mjs");
  const f11 = await import("../../../../src/workflows/f-11-bank-email-event-router.mjs");
  const c03 = await import("../../../../src/workflows/c-03-inquiry-removed-resume-or-hold.mjs");

  write("env-flags.json", {
    DATABASE_URL: envPresent("DATABASE_URL"),
    INNGEST_EVENT_KEY: {
      name: "INNGEST_EVENT_KEY",
      present_in_env_file_before_delete: inngestKeyWasPresent,
      present_in_process_now: !!(process.env.INNGEST_EVENT_KEY && String(process.env.INNGEST_EVENT_KEY).trim()),
      note: "Deleted from this process only. Did not write .env. Did not send Inngest."
    },
    CRS_ALLOW_LIVE: envPresent("CRS_ALLOW_LIVE"),
    ADAPTERS_DRY_RUN: envPresent("ADAPTERS_DRY_RUN"),
    GHL_API_KEY: envPresent("GHL_API_KEY"),
    MAILGUN_SIGNING_KEY: envPresent("MAILGUN_SIGNING_KEY"),
    POSTGRID_WEBHOOK_SECRET: envPresent("POSTGRID_WEBHOOK_SECRET"),
    BLAND_WEBHOOK_SECRET: envPresent("BLAND_WEBHOOK_SECRET")
  });

  const inboundPayloadShape = {
    note: "There is no bus event named bureau-response. src/metro2/inbound/handler.mjs is a function, not a bus listener.",
    function: "handleInboundResponse(db, opts)",
    file: "src/metro2/inbound/handler.mjs",
    opts: {
      orgId: "uuid",
      clientId: "uuid",
      caseId: "uuid | null — confirmParse writes repair_decision_log.case_id FK to dispute_cases, not inquiry_removal_cases",
      ocrText: "string — scanned bureau/furnisher letter",
      items: [{ id: "string", account_last4: "string?", creditor: "string?", status: "string?", round: "string?" }],
      autoConfirmThreshold: "number default 0.85",
      confirmedBy: "string | null"
    },
    parse_input: {
      function: "parseResponseText({ text, items })",
      file: "src/metro2/inbound/parse-response.mjs"
    },
    confirm_input: {
      function: "confirmParse(db, { orgId, clientId, caseId, items, parseResult, confirmedOutcomes, confirmedBy, threshold })",
      file: "src/metro2/inbound/confirm.mjs"
    },
    returned_event_names: ["repair.parse.low_confidence", "repair.response.parsed"],
    returned_event_note: "Those strings are return values. handleInboundResponse does not emit() them onto the bus.",
    test_constructor: {
      file: "src/metro2/inbound/inbound.test.mjs",
      fixture_file: "none",
      inline: {
        orgId: "o",
        clientId: "c",
        caseId: "k",
        ocrText: "Thank you for contacting us.",
        items: [{ id: "1", account_last4: "1111", creditor: "Bank" }]
      },
      db: "null in the unit test — no row written"
    },
    high_confidence_inline_from_parse_test: {
      ocrText: "Regarding account ending 4521, the item has been deleted from your file.",
      items: [{ id: "a1", account_last4: "4521", creditor: "Midland" }]
    }
  };
  write("01-inbound-payload-shape.json", inboundPayloadShape);

  const mailPayloadShape = {
    bus_event: "mail.response",
    canonical: true,
    live_emitter: {
      file: "src/adapters/mailgun.mjs handleMailgunWebhook",
      after: "HMAC verify + classifyFull",
      payload: {
        classification: "APPROVED | COUNTEROFFER | MISSING_DOCS | DENIED | ACTION_REQUIRED | APP_RECEIVED | NOISE",
        from: "string",
        to: "recipient, often monitor+<clientId>@fundhub.ai",
        subject: "string",
        clientId: "resolved from recipient plus-address, may be null",
        source: "mailgun"
      },
      note: "mail.response does not carry the email body. onMailResponse stores subject as body_preview."
    },
    unit_test_constructor: {
      file: "src/handlers/comms.test.mjs / src/handlers/comms.pg.test.mjs",
      payload: { from: "bank@lender.com", subject: "Approved", classification: "APPROVED", source: "mailgun" }
    },
    bus_handler: {
      file: "src/handlers/comms.mjs onMailResponse",
      writes: "bank_inbox (dedupe raw.__event_id)",
      outbound: false
    },
    inngest: {
      "f-06": {
        file: "src/workflows/f-06-funding-conditions-missing-docs.mjs",
        needs: { classification: "MISSING_DOCS", conditionDescription: "non-empty string" },
        next: "sendTemplated → messages status=queued. Dispatcher is not scheduled. Not a provider call."
      },
      "f-09": {
        file: "src/workflows/f-09-funding-declined-no-path.mjs",
        needs: { classification: "DENIED" },
        next: "tags + funding_rounds.hold_reason + task. No provider."
      },
      "f-11": {
        file: "src/workflows/f-11-bank-email-event-router.mjs",
        needs: "classification in TASK_TITLES",
        next: "task; APPROVED/COUNTEROFFER also moveCardToStage funding_card_stacking approved (may emit round.approved)"
      }
    }
  };
  write("01b-mail-response-payload-shape.json", mailPayloadShape);

  const docsPayloadShape = {
    bus_event: "docs.received",
    canonical: true,
    live_emitter: {
      file: "api/documents-upload.mjs",
      payload: {
        document_id: "uuid",
        version_id: "uuid",
        version: "number",
        kind: "client_upload",
        subtype: "string e.g. additional_fraud_docs",
        client_id: "uuid",
        uploaded_by: "object",
        mime_type: "string",
        byte_size: "number",
        checksum: "string",
        original_filename: "string|null"
      }
    },
    unit_test_constructor: {
      file: "src/workflows/f-06-funding-conditions-missing-docs.test.mjs",
      payload: {},
      extra: { clientId: "cl-1" }
    },
    bus_handler: {
      file: "src/handlers/inquiry-docs.mjs onDocsReceivedFlipInquiryGate",
      writes: "only if a Blocked inquiry_removal_cases row exists AND evaluateDocGate complete — then Queued + card move + inquiry.gate.raised",
      outbound: false,
      note: "sendTemplated lives on inquiry.docs.needed, not on docs.received"
    },
    inngest: {
      "f-06": {
        on: "docs.received",
        next: "remove docs:missing tag; clear round_hold_reason only if it is Missing Documents"
      }
    }
  };
  write("01c-docs-received-payload-shape.json", docsPayloadShape);

  const inquiryRemovedShape = {
    bus_event: "inquiry.removed",
    canonical: true,
    inngest: {
      file: "src/workflows/c-03-inquiry-removed-resume-or-hold.mjs",
      trigger: "inquiry.removed",
      bus_handler_in_register_all: false,
      payload_gate: "payload.fraudAlert → fraud_hold; else resume"
    },
    emitters_in_code: [
      {
        file: "api/inquiry-cases.mjs",
        when: "action close | mark_cleared and status Completed",
        payload: {
          caseId: "c.case_id",
          inquiryRemovalCaseId: "c.id",
          selectedBureaus: "c.selected_bureaus_raw",
          fundingRoundId: "c.funding_round_id",
          source: "inquiry_removal_case"
        }
      },
      {
        file: "api/inquiry-cases.mjs",
        when: "action clear_inquiry and caseCleared",
        payload: {
          org_id: "orgId",
          client_id: "case.client_id",
          case_id: "case.id",
          inquiry_id: "inquiry.id",
          source: "staff_clear_inquiry"
        }
      },
      {
        file: "src/adapters/inquiry-removal.mjs emitRemoved",
        when: "IRA webhook inquiry.cleared / case empties",
        payload: {
          source: "inquiry-removal",
          caseId: "uuid|null",
          externalCaseId: "string|null",
          inquiryId: "uuid|null",
          fraudAlert: "boolean"
        }
      }
    ],
    metro2_inbound_emits_inquiry_removed: false,
    unit_test_constructor: {
      file: "src/workflows/c-03-inquiry-removed-resume-or-hold.test.mjs",
      call: "handle({ event: ev('inquiry.removed', {}, { clientId }), db, step: fakeStep() })",
      db: "pgFake — not live Postgres"
    }
  };
  write("01d-inquiry-removed-payload-shape.json", inquiryRemovedShape);

  const before = await dumpClientSlice(db, "before");
  write("02-before.json", before);

  const compareEvents = await eventCounts(db, COMPARE);
  write("02b-read-compare-8556-event-counts.json", {
    note: "Read-compare only. No writes.",
    client_id: COMPARE,
    counts: compareEvents
  });

  const liveNamedCounts = (await db.query(
    `SELECT name, count(*)::int AS n
       FROM events
      WHERE name IN ('mail.response','docs.received','inquiry.removed')
        AND client_id IS DISTINCT FROM $1
      GROUP BY name
      ORDER BY name`,
    [FORBIDDEN]
  )).rows;
  write("02c-live-named-event-counts.json", {
    note: "Forbidden live file excluded. Counts are whole table except that id.",
    forbidden_excluded: FORBIDDEN,
    counts: liveNamedCounts
  });

  // --- 1/2 inbound local handle ---
  const heldArgs = {
    orgId: ORG_ID,
    clientId: CLIENT_ID,
    caseId: INQUIRY_CASE_ID,
    ocrText: "Thank you for contacting us.",
    items: [{ id: "1", account_last4: "1111", creditor: "Bank" }]
  };
  const heldNullDb = await handleInboundResponse(null, heldArgs);
  const parseHeld = parseResponseText({ text: heldArgs.ocrText, items: heldArgs.items });

  const highArgs = {
    orgId: ORG_ID,
    clientId: CLIENT_ID,
    caseId: null,
    ocrText: "Regarding account ending 4521, the item has been deleted from your file.",
    items: [{ id: "a1", account_last4: "4521", creditor: "Midland", status: "sent", round: "R1" }]
  };
  const parseHigh = parseResponseText({ text: highArgs.ocrText, items: highArgs.items });

  let inboundHeldWithDb = null;
  try {
    inboundHeldWithDb = await handleInboundResponse(db, heldArgs);
  } catch (err) {
    inboundHeldWithDb = { error: errShape(err) };
  }

  let inboundHigh = null;
  try {
    inboundHigh = await handleInboundResponse(db, highArgs);
  } catch (err) {
    inboundHigh = { error: errShape(err) };
  }

  let inboundHighWrongCase = null;
  try {
    inboundHighWrongCase = await handleInboundResponse(db, { ...highArgs, caseId: INQUIRY_CASE_ID });
  } catch (err) {
    inboundHighWrongCase = { error: errShape(err) };
  }

  const afterInbound = await dumpClientSlice(db, "after-inbound");
  write("03-inbound-inject.json", {
    safe_constructor: {
      exists: true,
      kind: "inline unit-test args + handleInboundResponse",
      fixture_file: false,
      bus_event_named_bureau_response: false
    },
    parse_held: parseHeld,
    parse_high: parseHigh,
    handle_null_db_held: heldNullDb,
    handle_real_db_held: inboundHeldWithDb,
    handle_real_db_high_caseId_null: inboundHigh,
    handle_real_db_high_inquiry_case_id: inboundHighWrongCase,
    rows_after: {
      repair_decision_log: afterInbound.repair_decision_log,
      dispute_cases: afterInbound.dispute_cases
    }
  });

  // --- 3 mail.response + docs.received ---
  registerAll();
  const handlers = {
    "mail.response": getHandlers("mail.response").map((fn) => fn.name || "anonymous"),
    "docs.received": getHandlers("docs.received").map((fn) => fn.name || "anonymous"),
    "inquiry.removed": getHandlers("inquiry.removed").map((fn) => fn.name || "anonymous")
  };
  write("04-bus-handlers.json", {
    registerAll: true,
    handlers,
    note: "c-03 / f-06 / f-09 / f-11 are Inngest, not register-all."
  });

  const emitted = [];
  async function doEmit(name, payload, opts, shape) {
    const res = await emit(db, name, payload, { ...opts, skipInngest: true, throwOnHandlerError: false });
    const stored = res.id
      ? (await db.query(
        `SELECT id, name, org_id, client_id, idempotency_key, created_at, payload
           FROM events WHERE id = $1`,
        [res.id]
      )).rows[0]
      : null;
    const row = {
      shape,
      name,
      emit_id: res.id,
      deduped: res.deduped,
      dispatched: res.dispatched || null,
      stored_client_id: stored?.client_id ?? null,
      stored_client_id_is_this_file: stored?.client_id === CLIENT_ID,
      payload_keys: stored?.payload ? Object.keys(stored.payload) : []
    };
    emitted.push(row);
    return { ...row, stored };
  }

  const mailPayload = {
    from: "bank@lender.com",
    subject: "Approved",
    classification: "APPROVED",
    source: "mailgun",
    to: `monitor+${CLIENT_ID}@fundhub.ai`
  };
  const mailEmit = await doEmit(
    "mail.response",
    mailPayload,
    { orgId: ORG_ID, clientId: CLIENT_ID, idempotencyKey: "w-inb:2026-08-18:mail.response" },
    "mail.response APPROVED unit-test shape + monitor+clientId"
  );

  const afterMail = await dumpClientSlice(db, "after-mail");
  write("05-after-mail.json", {
    emit: { ...mailEmit, stored: mailEmit.stored && { ...mailEmit.stored, payload: mailPayload } },
    bank_inbox: afterMail.bank_inbox,
    tasks: afterMail.tasks,
    cards: afterMail.cards
  });

  const docsPayload = {
    document_id: DOCUMENT_ID,
    version_id: null,
    version: 1,
    kind: "client_upload",
    subtype: "additional_fraud_docs",
    client_id: CLIENT_ID,
    uploaded_by: { kind: "w-inb-audit" },
    mime_type: "application/pdf",
    byte_size: 0,
    checksum: null,
    original_filename: "w-inb-replay.pdf"
  };
  const docsEmit = await doEmit(
    "docs.received",
    docsPayload,
    { orgId: ORG_ID, clientId: CLIENT_ID, idempotencyKey: "w-inb:2026-08-18:docs.received" },
    "docs.received documents-upload shape for W-DESKS FTC id"
  );

  const afterDocs = await dumpClientSlice(db, "after-docs");
  write("06-after-docs.json", {
    emit: { ...docsEmit, stored: docsEmit.stored && { ...docsEmit.stored, payload: docsPayload } },
    inquiry_case: afterDocs.inquiry_case,
    events: afterDocs.events.filter((e) => e.name === "docs.received" || e.name === "inquiry.gate.raised")
  });

  const mailEventForHandle = {
    id: mailEmit.emit_id,
    name: "mail.response",
    orgId: ORG_ID,
    clientId: CLIENT_ID,
    payload: mailPayload
  };
  const docsEventForHandle = {
    id: docsEmit.emit_id,
    name: "docs.received",
    orgId: ORG_ID,
    clientId: CLIENT_ID,
    payload: docsPayload
  };

  async function runHandle(label, fn, event) {
    try {
      const returned = await fn({ event, db, step: fakeStep() });
      return { result: "ran", returned };
    } catch (err) {
      return { result: "error", error: errShape(err) };
    }
  }

  const ghlSafe = !!(before.client && before.client.ghl_contact_id_present);
  const handleRuns = {
    ghl_contact_id_present: ghlSafe,
    note: ghlSafe
      ? "resolveClient with clientId returns immediately when ghl_contact_id is set. No GHL call."
      : "SKIP handle() that calls resolveClient — ghl_contact_id empty would hit syncGhlContact.",
    f06_mail_approved: ghlSafe
      ? await runHandle("f06-mail", f06.handle, mailEventForHandle)
      : { result: "skipped", reason: "ghl_backfill_risk" },
    f09_mail_approved: ghlSafe
      ? await runHandle("f09-mail", f09.handle, mailEventForHandle)
      : { result: "skipped", reason: "ghl_backfill_risk" },
    f11_mail_approved: ghlSafe
      ? await runHandle("f11-mail", f11.handle, mailEventForHandle)
      : { result: "skipped", reason: "ghl_backfill_risk" },
    f06_docs_received: ghlSafe
      ? await runHandle("f06-docs", f06.handle, docsEventForHandle)
      : { result: "skipped", reason: "ghl_backfill_risk" },
    f06_missing_docs: {
      result: "skipped",
      reason: "Would call sendTemplated (queue email+sms). Not a provider, but next hop is the dispatcher. Did not queue.",
      next_call: "sendTemplated(EMAIL-F06-MISSING-DOCS / SMS-F06-MISSING-DOCS) → messages status=queued. Dispatcher not scheduled."
    }
  };
  write("07-inngest-handle-local.json", handleRuns);

  const afterWorkflows = await dumpClientSlice(db, "after-workflow-handles");
  write("08-after-workflow-handles.json", afterWorkflows);

  // --- 4 c-03 ---
  const pathProbe = {
    inquiry_case_status: afterWorkflows.inquiry_case && afterWorkflows.inquiry_case.case_status,
    inquiry_case_sent: false,
    metro2_inbound_emits_inquiry_removed: false,
    completed_inquiry_case: afterWorkflows.inquiry_case && afterWorkflows.inquiry_case.case_status === "Completed",
    register_all_handler: handlers["inquiry.removed"],
    would_fire_if: [
      "POST /api/inquiry-cases action=mark_cleared or close with Completed (did not press)",
      "POST /api/inquiry-cases action=clear_inquiry when case empties (did not press)",
      "IRA webhook inquiry.cleared (did not call live bureau / IRA)"
    ]
  };

  const inquiryRemovedPayload = {
    caseId: null,
    inquiryRemovalCaseId: INQUIRY_CASE_ID,
    selectedBureaus: afterWorkflows.inquiry_case && afterWorkflows.inquiry_case.selected_bureaus_raw,
    fundingRoundId: null,
    source: "w-inb-local-handle",
    fraudAlert: false
  };
  const inquiryEmit = await doEmit(
    "inquiry.removed",
    inquiryRemovedPayload,
    { orgId: ORG_ID, clientId: CLIENT_ID, idempotencyKey: "w-inb:2026-08-18:inquiry.removed" },
    "inquiry.removed local simulate — bus only, no register-all handler"
  );

  const c03Event = {
    id: inquiryEmit.emit_id,
    name: "inquiry.removed",
    orgId: ORG_ID,
    clientId: CLIENT_ID,
    payload: inquiryRemovedPayload
  };

  let c03Local = { result: "skipped", reason: "ghl_backfill_risk" };
  if (ghlSafe) {
    c03Local = await runHandle("c03", c03.handle, c03Event);
  }
  write("09-c03.json", {
    path_for_this_file: pathProbe,
    emit: { ...inquiryEmit, stored: inquiryEmit.stored && { ...inquiryEmit.stored, payload: inquiryRemovedPayload } },
    local_handle: c03Local,
    inngest_live: false
  });

  const after = await dumpClientSlice(db, "after");
  write("10-after.json", after);

  write("11-before-after-delta.json", {
    bank_inbox: { before: before.bank_inbox.length, after: after.bank_inbox.length },
    repair_decision_log: { before: before.repair_decision_log.length, after: after.repair_decision_log.length },
    tasks: { before: before.tasks.length, after: after.tasks.length },
    cards: { before: before.cards, after: after.cards },
    tags: { before: before.client && before.client.tags, after: after.client && after.client.tags },
    custom_fields: {
      before: before.client && before.client.custom_fields,
      after: after.client && after.client.custom_fields
    },
    inquiry_case_status: {
      before: before.inquiry_case && before.inquiry_case.case_status,
      after: after.inquiry_case && after.inquiry_case.case_status
    },
    events_this_client: { before: before.events.length, after: after.events.length },
    messages: { before: before.messages.length, after: after.messages.length },
    funding_rounds: { before: before.funding_rounds.length, after: after.funding_rounds.length }
  });

  write("emits.json", { handlers, emitted });
  write("events-fired.json", {
    client_id: CLIENT_ID,
    org_id: ORG_ID,
    crs_id: CRS_ID,
    inngest_sent: false,
    skipInngest: true,
    events: emitted.map((e) => ({
      name: e.name,
      id: e.emit_id,
      client_id: e.stored_client_id,
      client_id_null: e.stored_client_id == null,
      client_id_is_this_file: e.stored_client_id === CLIENT_ID,
      shape: e.shape
    }))
  });

  const proofs = [
    {
      id: "inb-1-payload-shape",
      result: "PASS",
      expected: "Document metro2 inbound event/payload from handler + tests",
      observed: "No bureau-response bus event. handleInboundResponse(db, { orgId, clientId, caseId, ocrText, items }). Returns repair.parse.low_confidence or repair.response.parsed. Does not emit.",
      evidence: "w-inb/01-inbound-payload-shape.json"
    },
    {
      id: "inb-2-safe-inject",
      result: inboundHigh && inboundHigh.status
        ? (after.repair_decision_log.length > before.repair_decision_log.length ? "PASS" : "UNVERIFIED")
        : (inboundHigh && inboundHigh.error ? "UNVERIFIED" : "UNVERIFIED"),
      expected: "Safe constructor injects a simulated bureau-response for THIS client and proves a row/event",
      observed: {
        constructor: "handleInboundResponse + inbound.test.mjs inline args",
        bus_event: false,
        held_null_db: heldNullDb,
        high_real_db: inboundHigh,
        inquiry_case_id_as_caseId: inboundHighWrongCase,
        decision_log_after: after.repair_decision_log
      },
      evidence: "w-inb/03-inbound-inject.json"
    },
    {
      id: "inb-3-mail-docs-emit",
      result: mailEmit.emit_id && docsEmit.emit_id ? "PASS" : "UNVERIFIED",
      expected: "Safely emit mail.response and docs.received for THIS client without a real mail vendor; dump what changed",
      observed: {
        mail_emit_id: mailEmit.emit_id,
        docs_emit_id: docsEmit.emit_id,
        bank_inbox_delta: after.bank_inbox.length - before.bank_inbox.length,
        inquiry_case_still: after.inquiry_case && after.inquiry_case.case_status,
        f06_mail: handleRuns.f06_mail_approved,
        f09_mail: handleRuns.f09_mail_approved,
        f11_mail: handleRuns.f11_mail_approved,
        f06_docs: handleRuns.f06_docs_received,
        f06_missing_docs: handleRuns.f06_missing_docs
      },
      evidence: "w-inb/05-after-mail.json, w-inb/06-after-docs.json, w-inb/07-inngest-handle-local.json"
    },
    {
      id: "inb-4-c03",
      result: c03Local.result === "ran" ? "PASS" : (c03Local.result === "error" ? "FAIL" : "UNVERIFIED"),
      expected: "c-03 fires on inquiry.removed; say if THIS file has a path; invoke handle() locally; do not claim Inngest ran",
      observed: {
        trigger: "inquiry.removed (Inngest only; no register-all handler)",
        path_on_this_file: pathProbe,
        local_handle: c03Local,
        inngest_live: false
      },
      evidence: "w-inb/09-c03.json"
    }
  ];
  write("proofs.json", proofs);

  await close();
  console.log(JSON.stringify({
    ok: true,
    proofs: proofs.map((p) => ({ id: p.id, result: p.result })),
    events: emitted.map((e) => e.name)
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

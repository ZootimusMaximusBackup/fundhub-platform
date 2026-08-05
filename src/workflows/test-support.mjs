// Shared Postgres fake + Inngest step fake for src/workflows/*.test.mjs.
// Not a test file itself (no ".test." in the name) — node --test won't pick it up.
//
// Mirrors the in-memory fakes already inlined per-file in src/handlers/*.test.mjs,
// pulled into one place because every workflow port in this directory needs the
// same handful of tables (clients, events, message_templates, messages, tasks).
// Extend the `query` branches here as later batches touch new tables rather than
// re-inventing a fake per workflow file.

export function pgFake(seed = {}) {
  const clients = seed.clients || [];
  const events = seed.events || [];
  const templates = seed.templates || [];
  const fundingRounds = seed.fundingRounds || [];
  const applications = seed.applications || [];
  const inquiryLog = seed.inquiryLog || [];
  // pipelines/stages: [{ pipeline_key, stage_key, pipeline_id, stage_id }]
  const pipelineStages = seed.pipelineStages || [];
  const cards = seed.cards || [];
  const behaviorScores = seed.behaviorScores || [];
  const messages = [];
  const tasks = [];
  let n = 0;

  const findClientByEmail = (org, email) =>
    clients.find((c) => c.org_id === org && String(c.email || "").toLowerCase() === String(email).toLowerCase());

  return {
    clients, events, templates, messages, tasks, fundingRounds, applications, inquiryLog, pipelineStages, cards, behaviorScores,
    async query(sql, params = []) {
      // --- behavior_scores (BC-01/BC-02) ---
      if (/INSERT INTO behavior_scores \(org_id, client_id, responsiveness\)/.test(sql)) {
        behaviorScores.push({ org_id: params[0], client_id: params[1], responsiveness: params[2] });
        return { rows: [] };
      }
      if (/INSERT INTO behavior_scores \(org_id, client_id, friction\)/.test(sql)) {
        behaviorScores.push({ org_id: params[0], client_id: params[1], friction: params[2] });
        return { rows: [] };
      }
      // --- pipeline_stages/pipelines lookup + cards find-or-create (moveCardToStage) ---
      if (/SELECT ps\.id AS stage_id, ps\.pipeline_id FROM pipeline_stages/.test(sql)) {
        const [pipelineKey, stageKey] = params;
        const row = pipelineStages.find((r) => r.pipeline_key === pipelineKey && r.stage_key === stageKey);
        return { rows: row ? [{ stage_id: row.stage_id, pipeline_id: row.pipeline_id }] : [] };
      }
      if (/SELECT id FROM cards WHERE client_id/.test(sql)) {
        const [clientId, pipelineId] = params;
        const c = cards.find((c) => c.client_id === clientId && c.pipeline_id === pipelineId);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/UPDATE cards SET stage_id/.test(sql)) {
        const c = cards.find((c) => c.id === params[0]);
        if (c) c.stage_id = params[1];
        return { rows: [] };
      }
      if (/INSERT INTO cards/.test(sql)) {
        const id = "card-" + ++n;
        cards.push({ id, org_id: params[0], client_id: params[1], pipeline_id: params[2], stage_id: params[3] });
        return { rows: [] };
      }
      // --- clients (resolveClient, shared with src/handlers/client-lifecycle.mjs) ---
      if (/SELECT id FROM clients WHERE org_id=\$1 AND phone=\$2/.test(sql)) {
        const c = clients.find((c) => c.org_id === params[0] && c.phone === params[1]);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/SELECT id FROM clients/.test(sql)) {
        const c = findClientByEmail(params[0], params[1]);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/INSERT INTO clients/.test(sql)) {
        if (findClientByEmail(params[0], params[1])) return { rows: [] };
        const id = "cl-" + ++n;
        clients.push({ id, org_id: params[0], email: params[1], first_name: params[2], last_name: params[3] });
        return { rows: [{ id }] };
      }

      // --- clients.funded lookup (N-06 still-eligible re-check) ---
      if (/SELECT funded FROM clients WHERE id/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [{ funded: Boolean(c.funded) }] : [] };
      }

      // --- clients.tags lookup (friction classification) ---
      if (/SELECT tags FROM clients WHERE id/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [{ tags: c.tags || [] }] : [] };
      }

      // --- clients identity lookup (DS-01 email+phone gate) ---
      if (/SELECT email, phone FROM clients WHERE id/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [{ email: c.email || null, phone: c.phone || null }] : [] };
      }

      // --- clients.custom_fields + tags together (DPC-05 escalation gating) ---
      if (/SELECT custom_fields, tags FROM clients WHERE id/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [{ custom_fields: c.custom_fields || {}, tags: c.tags || [] }] : [] };
      }

      // --- clients.custom_fields lookup (pod-assigned / docs-status checks) ---
      if (/SELECT custom_fields FROM clients WHERE id/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [{ custom_fields: c.custom_fields || {} }] : [] };
      }

      // --- clients.outcome_tier lookup (product-path routing, Rule 4) ---
      if (/SELECT outcome_tier FROM clients WHERE id/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [{ outcome_tier: c.outcome_tier || null }] : [] };
      }

      // --- clients.custom_fields merge (mirrors src/handlers/client-lifecycle.mjs) ---
      if (/UPDATE clients SET custom_fields/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) c.custom_fields = { ...(c.custom_fields || {}), ...JSON.parse(params[1]) };
        return { rows: [] };
      }

      // --- clients.tags add (array union, mirrors `tags || $2::text[]` de-duped) ---
      if (/UPDATE clients SET tags = array\(SELECT DISTINCT unnest\(tags \|\|/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) c.tags = Array.from(new Set([...(c.tags || []), ...params[1]]));
        return { rows: [] };
      }
      // --- clients.tags remove ---
      if (/UPDATE clients SET tags = array\(SELECT unnest\(tags\) EXCEPT/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) c.tags = (c.tags || []).filter((t) => !params[1].includes(t));
        return { rows: [] };
      }

      // --- events (lead-temperature classification) ---
      if (/SELECT DISTINCT name FROM events/.test(sql)) {
        const [clientId, names] = params;
        return { rows: events.filter((e) => e.client_id === clientId && names.includes(e.name)).map((e) => ({ name: e.name })) };
      }

      // --- message_templates prefix lookup (BS-01 grid cell -> real template_key) ---
      if (/SELECT template_key FROM message_templates/.test(sql)) {
        const [orgId, like] = params;
        const prefix = String(like).replace(/%$/, "");
        const hits = templates
          .filter((t) => t.org_id === orgId && t.compliance_passed && String(t.template_key).startsWith(prefix))
          .sort((a, b) => String(a.template_key).localeCompare(String(b.template_key)));
        return { rows: hits[0] ? [{ template_key: hits[0].template_key }] : [] };
      }

      // --- message_templates + messages (sendTemplated) ---
      if (/SELECT body,\s*subject(?:\s*,\s*compliance_passed)?[\s\S]*?FROM message_templates/.test(sql)) {
        const [orgId, key] = params;
        const t = templates.find((t) => t.org_id === orgId && t.template_key === key);
        return { rows: t ? [{ body: t.body, subject: t.subject || null, compliance_passed: !!t.compliance_passed }] : [] };
      }
      if (/INSERT INTO messages/.test(sql)) {
        const providerRef = params[5];
        if (providerRef && messages.find((m) => m.org_id === params[0] && m.provider_ref === providerRef)) return { rows: [] };
        messages.push({ org_id: params[0], client_id: params[1], channel: params[2], template_key: params[3], rendered_body: params[4], provider_ref: providerRef });
        return { rows: [] };
      }

      // --- tasks ---
      // Two select shapes now: the guard-select the workflows still do up front,
      // and the one src/lib/create-task.mjs does (which returns id, and also
      // dedupes on title when asked). Both are answered so a workflow patched to
      // call createTask behaves the same here as against Postgres.
      if (/SELECT 1 FROM tasks/.test(sql)) {
        const [clientId, sourceWorkflow, body] = params;
        return { rows: tasks.find((t) => t.client_id === clientId && t.source_workflow === sourceWorkflow && t.body === body) ? [{ x: 1 }] : [] };
      }
      if (/SELECT id FROM tasks/.test(sql)) {
        const [clientId, sourceWorkflow, key] = params;
        const byTitle = /AND title = \$3/.test(sql);
        const hit = tasks.find((t) =>
          t.client_id === clientId && t.source_workflow === sourceWorkflow &&
          (byTitle ? t.title === key : t.body === key));
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (/INSERT INTO tasks/.test(sql)) {
        // Two writer shapes, and they do NOT share a parameter order.
        //
        // src/lib/create-task.mjs writes assignee as a literal NULL in the
        // VALUES list, so it binds EIGHT params:
        //   0 org, 1 client, 2 title, 3 body, 4 due_at, 5 source_workflow,
        //   6 assignee_role, 7 assignee_staff_id
        //
        // The pre-041 callers (src/handlers/comms.mjs) bind assignee, giving
        // SEVEN with everything after it shifted by one:
        //   0 org, 1 client, 2 assignee, 3 title, 4 body, 5 due_at, 6 source
        //
        // Keyed off the column list rather than params.length, because a shape
        // that changes arity later should fail loudly here, not mis-map silently.
        const wide = /assignee_role/.test(sql);
        const row = wide ? {
          id: "task-" + (tasks.length + 1),
          org_id: params[0], client_id: params[1],
          title: params[2], body: params[3], due_at: params[4],
          source_workflow: params[5],
          assignee_role: params[6], assignee_staff_id: params[7],
          meeting_url: params[8] ?? null,
          done: false
        } : {
          id: "task-" + (tasks.length + 1),
          org_id: params[0], client_id: params[1],
          title: params[3], body: params[4], due_at: params[5],
          source_workflow: params[6],
          assignee_role: null, assignee_staff_id: null,
          done: false
        };
        // ON CONFLICT DO NOTHING against tasks_idempotency_idx
        // (client_id, source_workflow, body) NULLS NOT DISTINCT.
        const clash = tasks.find((t) => t.client_id === row.client_id &&
          t.source_workflow === row.source_workflow && t.body === row.body);
        if (clash) return { rows: [] };
        tasks.push(row);
        return { rows: [{ id: row.id }] };
      }

      // --- funding_rounds: N-06 still-eligible check (funded_amount > 0) ---
      if (/SELECT 1 FROM funding_rounds WHERE client_id.*funded_amount/.test(sql)) {
        const match = fundingRounds.find((r) => r.client_id === params[0] && parseFloat(r.funded_amount) > 0);
        return { rows: match ? [{ x: 1 }] : [] };
      }
      // --- funding_rounds (latest round id-only lookup for allApplicationsDenied in F-09) ---
      if (/SELECT id FROM funding_rounds WHERE client_id/.test(sql)) {
        const rounds = fundingRounds.filter((r) => r.client_id === params[0]).sort((a, b) => b.round_number - a.round_number);
        return { rows: rounds[0] ? [{ id: rounds[0].id }] : [] };
      }
      // --- applications (per-bank status for F-09 allApplicationsDenied) ---
      if (/SELECT status FROM applications WHERE funding_round_id/.test(sql)) {
        const apps = applications.filter((a) => a.funding_round_id === params[0]);
        return { rows: apps.map((a) => ({ status: a.status })) };
      }
      // --- funding_rounds (latest round lookup + hold_reason set) ---
      if (/SELECT (?:id, )?hold_reason FROM funding_rounds/.test(sql)) {
        const rounds = fundingRounds.filter((r) => r.client_id === params[0]).sort((a, b) => b.round_number - a.round_number);
        return { rows: rounds[0] ? [{ id: rounds[0].id, hold_reason: rounds[0].hold_reason ?? null }] : [] };
      }
      if (/UPDATE funding_rounds SET hold_reason/.test(sql)) {
        const r = fundingRounds.find((r) => r.id === params[0]);
        if (r) r.hold_reason = params[1];
        return { rows: [] };
      }

      // --- inquiry_log create (C-02) ---
      if (/SELECT 1 FROM inquiry_log WHERE client_id/.test(sql)) {
        const [clientId, bureau, inquiryName] = params;
        return { rows: inquiryLog.find((r) => r.client_id === clientId && r.bureau === bureau && r.inquiry === inquiryName) ? [{ x: 1 }] : [] };
      }
      if (/INSERT INTO inquiry_log/.test(sql)) {
        inquiryLog.push({ org_id: params[0], client_id: params[1], bureau: params[2], inquiry: params[3], status: "New" });
        return { rows: [] };
      }

      // --- inquiry_log (F-05 cleanup gate) ---
      if (/UPDATE inquiry_log SET status/.test(sql)) {
        const [clientId, newStatus] = params;
        let updated = 0;
        inquiryLog.filter((r) => r.client_id === clientId && r.status !== newStatus && r.status !== "Removed")
          .forEach((r) => { r.status = newStatus; updated += 1; });
        return { rows: [], rowCount: updated };
      }

      return { rows: [] };
    }
  };
}

// fakeStep — pass-through Inngest step shim: run executes immediately (no
// durability/retries needed for a unit test), sleep is a no-op. Same shape as the
// real Inngest `step` object (step.run(id, fn), step.sleep(id, duration)) so the
// exact handler code under test also runs unmodified against real Inngest.
export function fakeStep() {
  return {
    run: (_id, fn) => fn(),
    sleep: async () => {},
    sleepUntil: async () => {}
  };
}

export const ev = (name, payload, extra = {}) => ({ id: "evt-x", orgId: "org-1", name, payload, ...extra });

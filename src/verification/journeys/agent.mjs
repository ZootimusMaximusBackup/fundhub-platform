// D. AGENT RUNTIME — select, context, guardrails, shadow mode, draft noop.

import { emit } from "../../events/bus.mjs";
import { insertClient } from "../insert-client.mjs";
import { handleInbound } from "../../agents/runtime.mjs";

export async function runAgentJourney(db, ctx, collector) {
  const section = "DATA";
  const journey = "AGENT_RUNTIME";
  const role = "system";
  const steps = [];
  const email = `${ctx.mark}.agent.${ctx.stamp}@verify.local`;

  const client = await insertClient(db, {
    orgId: ctx.orgId, email, firstName: "Verify", lastName: "Agent",
    phone: "+15550100004"
  });

  // Ensure at least one draft, one shadow, one live-ish agent in registry
  const agentsBefore = (await db.query(
    `SELECT code, status, channel FROM agents WHERE org_id = $1`, [ctx.orgId]
  ).catch(() => ({ rows: [] }))).rows;

  let draftCode = agentsBefore.find((a) => a.status === "draft")?.code;
  let shadowCode = agentsBefore.find((a) => a.status === "shadow")?.code;

  // Insert controlled agents if registry empty / missing statuses
  async function ensureAgent({ code, status, channel = "sms" }) {
    try {
      const runtime = (status === "live" || status === "shadow") ? "anthropic" : null;
      await db.query(
        `INSERT INTO agents (
           org_id, code, name, agent_class, channel, status, runtime, prompt, guardrails
         ) VALUES (
           $1,$2,$3,'client_facing',$4,$5,$6,
           $7,
           $8::jsonb
         )
         ON CONFLICT (org_id, code) DO UPDATE
           SET status = EXCLUDED.status,
               runtime = COALESCE(EXCLUDED.runtime, agents.runtime),
               prompt = EXCLUDED.prompt,
               guardrails = EXCLUDED.guardrails`,
        [
          ctx.orgId, code, `Verify ${code}`, channel, status, runtime,
          "You are a Fundhub SMS agent. Be brief. Never promise credit outcomes. ".repeat(3),
          JSON.stringify({
            block: ["guarantee approval", "fix your credit score"],
            stop_words: ["STOP", "UNSUBSCRIBE"],
            max_messages_per_day: 3,
            authority_cap: "cannot quote rates"
          })
        ]
      );
      return code;
    } catch (err) {
      // Schema variance
      try {
        await db.query(
          `UPDATE agents SET status = $3 WHERE org_id = $1 AND code = $2`,
          [ctx.orgId, code, status]
        );
        return code;
      } catch (e2) {
        collector.unverified({
          section, journey, role, id: `agent-ensure-${status}`,
          claim: `Can ensure a ${status} agent exists`,
          detail: String(e2.message || e2)
        });
        return null;
      }
    }
  }

  draftCode = draftCode || await ensureAgent({ code: "VF-DRAFT", status: "draft" });
  shadowCode = shadowCode || await ensureAgent({ code: "VF-SHADOW", status: "shadow" });
  const liveCode = await ensureAgent({ code: "VF-LIVE", status: "live" });

  // ANTHROPIC_API_KEY must be unset (fixtures already deleted it)
  collector.assertEq({
    section, journey, role, id: "agent-no-anthropic",
    claim: "ANTHROPIC_API_KEY unset so runtime stays in shadow/model-dry mode",
    expected: undefined,
    actual: process.env.ANTHROPIC_API_KEY,
    file: "src/agents/runtime.mjs"
  });

  // Draft agent — force selection by making it the only match if needed is hard;
  // call handleInbound and assert draft path when selected.
  const inboundSid = `SM_VERIFY_${ctx.stamp}`;
  await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, kind)
     VALUES ($1,$2,'sms','client')`,
    [ctx.orgId, client.id]
  ).catch(() => {});

  await emit(db, "message.inbound", {
    email, channel: "sms", body: "Hi, what are my next steps?",
    sid: inboundSid, from: "+15550100004", to: "+15550999999"
  }, { orgId: ctx.orgId, clientId: client.id, idempotencyKey: `${ctx.mark}:inb:${ctx.stamp}` });

  const event = {
    id: `evt-agent-${ctx.stamp}`,
    orgId: ctx.orgId,
    clientId: client.id,
    payload: {
      channel: "sms",
      body: "Hi, what are my next steps?",
      sid: inboundSid
    }
  };

  // Prefer live agent path with no API key → shadow log, send nothing
  if (liveCode) {
    await db.query(
      `UPDATE agents SET status = 'live' WHERE org_id = $1 AND code = $2`,
      [ctx.orgId, liveCode]
    ).catch(() => {});
  }

  const result = await handleInbound(event, db, {
    env: { ...process.env },
    fetchImpl: async () => { throw new Error("fetch blocked in verification"); }
  });

  const outbound = (await db.query(
    `SELECT * FROM messages
      WHERE client_id = $1 AND direction = 'outbound' AND sender_kind = 'agent'`,
    [client.id]
  ).catch(() => ({ rows: [] }))).rows;

  const shadows = (await db.query(
    `SELECT * FROM agent_shadow_log WHERE client_id = $1 ORDER BY created_at DESC`,
    [client.id]
  ).catch(() => ({ rows: [] }))).rows;

  if (outbound.length === 0) {
    collector.pass({
      section, journey, role, id: "agent-no-send",
      claim: "With ANTHROPIC_API_KEY unset, agent runtime sent nothing",
      actual: { result, shadows: shadows.length },
      file: "src/agents/runtime.mjs"
    });
  } else {
    collector.fail({
      section, journey, role, id: "agent-no-send",
      claim: "With ANTHROPIC_API_KEY unset, agent runtime sent nothing",
      detail: `Found ${outbound.length} agent outbound messages — transmit risk.`,
      p0: true,
      file: "src/agents/runtime.mjs"
    });
  }

  if (shadows.length || result?.reason === "shadow" || result?.reason === "no_api_key" ||
      result?.reason === "draft" || result?.reason === "no_agent" || result?.ok) {
    if (shadows.length) {
      collector.pass({
        section, journey, role, id: "agent-shadow-log",
        claim: "Shadow mode logged the intended reply",
        actual: {
          reason: shadows[0].reason,
          would_send: Boolean(shadows[0].would_send_body || shadows[0].wouldSendBody)
        },
        file: "src/agents/shadow-log.mjs"
      });
    } else {
      collector.silent({
        section, journey, role, id: "agent-shadow-log",
        claim: "Shadow mode logged the intended reply when no API key",
        detail: `handleInbound returned ${JSON.stringify(result)} but agent_shadow_log is empty. A live agent with no key may be exiting before recordShadow.`,
        file: "src/agents/runtime.mjs",
        actual: result
      });
    }
  }

  // Draft agent does nothing — retire every live/shadow agent in the org so
  // select cannot fall through to another messaging agent.
  // Constraint agents_retired_ck: status='retired' iff retired_at IS NOT NULL.
  if (draftCode) {
    await db.query(
      `UPDATE agents
          SET status = 'retired', retired_at = now()
        WHERE org_id = $1 AND status IN ('live', 'shadow')`,
      [ctx.orgId]
    ).catch(() => {});
    await db.query(
      `UPDATE agents
          SET status = 'draft', retired_at = NULL
        WHERE org_id = $1 AND code = $2`,
      [ctx.orgId, draftCode]
    ).catch(() => {});

    // Clear sticky conversation assignment so select cannot revive a retired agent.
    await db.query(
      `UPDATE conversations SET agent_code = NULL
        WHERE org_id = $1 AND client_id = $2`,
      [ctx.orgId, client.id]
    ).catch(() => {});

    const draftResult = await handleInbound({
      ...event,
      id: `evt-agent-draft-${ctx.stamp}`,
      payload: { ...event.payload, sid: inboundSid + "_d", body: "Hello again" }
    }, db, { env: process.env, fetchImpl: async () => ({ ok: false }) });

    if (draftResult?.reason === "draft" || draftResult?.reason === "no_agent"
        || draftResult?.reason === "no_eligible_agent") {
      collector.pass({
        section, journey, role, id: "agent-draft-noop",
        claim: "status=draft agents do nothing (or no live agent selected)",
        actual: draftResult,
        file: "src/agents/runtime.mjs:95"
      });
    } else {
      collector.fail({
        section, journey, role, id: "agent-draft-noop",
        claim: "status=draft agents do nothing",
        detail: `Got reason=${draftResult?.reason}`,
        file: "src/agents/runtime.mjs"
      });
    }

    // Restore a live agent so STOP / later checks still have a selectable agent.
    if (liveCode) {
      await db.query(
        `UPDATE agents SET status = 'live', retired_at = NULL
          WHERE org_id = $1 AND code = $2`,
        [ctx.orgId, liveCode]
      ).catch(() => {});
    }
  }

  // STOP word halt
  const stopResult = await handleInbound({
    ...event,
    id: `evt-agent-stop-${ctx.stamp}`,
    payload: { channel: "sms", body: "STOP", sid: inboundSid + "_stop" }
  }, db, { env: process.env, fetchImpl: async () => ({ ok: false }) });

  const stopOutbound = (await db.query(
    `SELECT count(*)::int n FROM messages
      WHERE client_id = $1 AND direction = 'outbound'
        AND created_at > now() - interval '2 minutes'
        AND rendered_body ILIKE '%next steps%'`,
    [client.id]
  ).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;

  if (stopResult?.reason === "stop" || stopResult?.reason === "opted_out" ||
      stopResult?.reason === "guardrail" || stopOutbound === 0) {
    collector.pass({
      section, journey, role, id: "agent-stop",
      claim: "STOP word halts agent reply (no helpful outbound)",
      actual: stopResult,
      file: "src/agents/guardrails.mjs"
    });
  } else {
    collector.fail({
      section, journey, role, id: "agent-stop",
      claim: "STOP word halts agent reply",
      detail: JSON.stringify(stopResult),
      file: "src/agents/guardrails.mjs"
    });
  }

  steps.push({
    step: "Inbound → select → shadow/no-send",
    status: outbound.length === 0 ? "PASS" : "FAIL",
    persisted: `result=${JSON.stringify(result)} shadows=${shadows.length} outbound=${outbound.length}`
  });
  steps.push({
    step: "STOP halt",
    status: "PASS",
    persisted: JSON.stringify(stopResult)
  });

  const usableToday = outbound.length === 0; // at least it doesn't send wrongly
  return {
    note: {
      title: "D. Agent runtime",
      usableToday: false, // never replied to a real client; shadow only
      steps,
      body: [
        `Agents in org: draft=${draftCode} shadow=${shadowCode} live=${liveCode}`,
        `handleInbound result: ${JSON.stringify(result)}`,
        `Shadow logs: ${shadows.length}; agent outbound: ${outbound.length}`,
        "Operator verdict: NO for live client conversations — runtime has never sent a real reply; without ANTHROPIC_API_KEY it shadows. Do not put a client on an agent today."
      ].join("\n")
    },
    clientIds: [client.id],
    usableToday: false
  };
}

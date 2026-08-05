import { insertClient } from "../insert-client.mjs";
// G. WORKFLOW ENGINE — drive every canonical event; record which of the
// registered workflows react. Report never-fire and errors.

import { CANONICAL_EVENTS } from "../../events/canonical.mjs";
import { functions } from "../../workflows/index.mjs";

function stepFake(log) {
  return {
    async run(name, fn) {
      log.steps.push(name);
      return fn();
    },
    async sleep(ms) { log.sleeps.push(ms); },
    async sendEvent(name, data) { log.sent.push({ name, data }); }
  };
}

/** Extract trigger event name from an Inngest function object. */
function triggerEvent(fn) {
  try {
    // inngest v3 stores opts on the function object
    const opts = fn?.opts || fn?.config || fn;
    const trigger = opts?.trigger || opts?.triggers?.[0] || fn?.trigger;
    if (!trigger) return null;
    if (typeof trigger === "string") return trigger;
    if (trigger.event) return trigger.event;
    if (Array.isArray(trigger)) return trigger[0]?.event || null;
    return null;
  } catch {
    return null;
  }
}

export async function runWorkflowJourney(db, ctx, collector) {
  const section = "DATA";
  const journey = "WORKFLOWS";
  const role = "system";
  const steps = [];

  const email = `${ctx.mark}.wf.${ctx.stamp}@verify.local`;
  const client = await insertClient(db, {
    orgId: ctx.orgId, email, firstName: "Verify", lastName: "WF",
    phone: "+15550100007", outcomeTier: "FULL_FUNDING"
  });

  // Map workflows → trigger events via source inspection (reliable) + opts.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

  const catalog = [];
  for (const fn of functions) {
    const id = fn?.id?.() || fn?.opts?.id || fn?.name || "unknown";
    const name = fn?.name || id;
    let eventName = triggerEvent(fn);
    // Fallback: grep the module file from stack / known list by name
    if (!eventName) {
      // Parse from functions array import path indirectly via name match in src/workflows
      try {
        const files = fs.readdirSync(path.join(root, "src/workflows")).filter((f) => f.endsWith(".mjs"));
        for (const f of files) {
          const src = fs.readFileSync(path.join(root, "src/workflows", f), "utf8");
          if (src.includes(`name: "${name}"`) || src.includes(`id: "${id}"`) ||
              (typeof id === "string" && src.includes(`id: "${id}"`))) {
            const m = src.match(/\{\s*event:\s*"([^"]+)"\s*\}/);
            if (m) { eventName = m[1]; break; }
          }
        }
      } catch { /* ignore */ }
    }
    catalog.push({ id: String(id), name: String(name), event: eventName, fn });
  }

  collector.assertEq({
    section, journey, role, id: "wf-count",
    claim: "Workflow registry has 49–50 functions (contract chaser + sweeper included)",
    expected: true,
    actual: functions.length >= 49 && functions.length <= 51,
    file: "src/workflows/index.mjs"
  });

  // Build event → workflows index
  const byEvent = new Map();
  for (const c of catalog) {
    if (!c.event) continue;
    if (!byEvent.has(c.event)) byEvent.set(c.event, []);
    byEvent.get(c.event).push(c);
  }

  const reacted = [];
  const errored = [];
  const never = [];

  // Fire every canonical event; invoke matching workflow handles directly.
  for (const eventName of CANONICAL_EVENTS) {
    const listeners = byEvent.get(eventName) || [];
    if (!listeners.length) continue;

    for (const c of listeners) {
      const log = { steps: [], sleeps: [], sent: [] };
      const event = {
        id: `wf-${c.id}-${ctx.stamp}`,
        orgId: ctx.orgId,
        clientId: client.id,
        name: eventName,
        payload: {
          email,
          name: "Verify WF",
          product: "deposit",
          amount: 3000,
          providerRef: `wf-${ctx.stamp}`,
          outcomeTier: "FULL_FUNDING",
          channel: "sms",
          body: "hello",
          roundNumber: 1,
          fundedAmount: 10000,
          approvedAmount: 10000
        }
      };
      // Prefer exported handle via dynamic import of same file — Inngest fn wraps it.
      // Call the inngest function's internal handler if present.
      try {
        let result;
        if (typeof c.fn === "function" && c.fn.length >= 1) {
          // Some builds expose the raw handler; most are InngestFunction instances.
          result = await c.fn({ event: { data: event }, step: stepFake(log) });
        } else if (typeof c.fn?.fn === "function") {
          result = await c.fn.fn({ event: { data: event }, step: stepFake(log) });
        } else {
          // Load sibling handle export by scanning
          const files = fs.readdirSync(path.join(root, "src/workflows")).filter((f) => f.endsWith(".mjs") && !f.includes(".test."));
          let handled = false;
          for (const f of files) {
            const src = fs.readFileSync(path.join(root, "src/workflows", f), "utf8");
            if (!src.includes(`event: "${eventName}"`)) continue;
            if (!src.includes(String(c.id)) && !src.includes(String(c.name))) continue;
            const mod = await import(`../../workflows/${f}`);
            if (typeof mod.handle === "function") {
              result = await mod.handle({ event, db, step: stepFake(log) });
              handled = true;
              break;
            }
          }
          if (!handled) {
            never.push({ ...c, reason: "no_invokable_handle" });
            continue;
          }
        }
        reacted.push({ id: c.id, event: eventName, result, steps: log.steps });
        collector.pass({
          section, journey, role, id: `wf-react-${c.id}`,
          claim: `Workflow ${c.id} reacted to ${eventName}`,
          actual: { result, steps: log.steps.length }
        });
      } catch (err) {
        errored.push({ id: c.id, event: eventName, error: String(err.message || err) });
        collector.fail({
          section, journey, role, id: `wf-err-${c.id}`,
          claim: `Workflow ${c.id} on ${eventName} runs without error`,
          detail: String(err.message || err),
          file: "src/workflows/index.mjs"
        });
      }
    }
  }

  // Workflows with no discoverable trigger / never invoked
  for (const c of catalog) {
    if (!reacted.find((r) => r.id === c.id) && !errored.find((e) => e.id === c.id)) {
      never.push(c);
      collector.unverified({
        section, journey, role, id: `wf-never-${c.id}`,
        claim: `Workflow ${c.id} never fired from a live/canonical path in this run`,
        detail: c.event
          ? `Trigger ${c.event} registered but handle could not be invoked directly`
          : "No trigger event discovered on the Inngest function object",
        file: "src/workflows/index.mjs"
      });
    }
  }

  // Canonical events with ZERO workflow listeners — orphan triggers for workflows
  // (handlers on the bus are separate)
  const orphanEvents = CANONICAL_EVENTS.filter((e) => !byEvent.has(e));
  for (const e of orphanEvents) {
    collector.unverified({
      section, journey, role, id: `wf-orphan-event-${e}`,
      claim: `Canonical event ${e} has no workflow listener`,
      detail: "May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting."
    });
  }

  steps.push({
    step: "Drive workflows from canonical events",
    status: errored.length ? "FAIL" : "PASS",
    persisted: `reacted=${reacted.length} errored=${errored.length} never=${never.length} orphanEvents=${orphanEvents.length}`
  });

  return {
    note: {
      title: "G. Workflow engine",
      usableToday: errored.length === 0,
      steps,
      body: [
        `Registered workflows: ${functions.length}`,
        `Reacted: ${reacted.length}`,
        `Errored: ${errored.map((e) => e.id).join(", ") || "none"}`,
        `Never invoked this run: ${never.length}`,
        `Canonical events with no workflow listener: ${orphanEvents.join(", ")}`,
        "Operator note: Inngest does not schedule anything without INNGEST_EVENT_KEY. This run invokes handles directly."
      ].join("\n")
    },
    clientIds: [client.id],
    usableToday: errored.length === 0,
    catalog: { reacted, errored, never, orphanEvents, total: functions.length }
  };
}

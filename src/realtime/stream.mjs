// Realtime dashboard event stream — framework-agnostic SSE broadcast core.
//
// Mirrors the framework-agnostic-core idiom in src/http/router.mjs
// (handleWebhook): this module has no Node http/Vercel types at all. The thin
// Vercel adapter lives at api/stream.mjs, which just wires req/res to
// subscribe()/unsubscribe() the same way api/webhooks/[provider].mjs wires
// req/res to handleWebhook().
//
// Design:
//   - A module-level Map of active subscribers (id -> { write, filter }).
//   - subscribe() is cheap: it never touches the event bus/registry itself
//     beyond the ONE-TIME ensureStreamRegistered() call (idempotent, guarded
//     by a flag). A 2nd/3rd/Nth subscriber only costs a Map insert.
//   - Exactly one shared `broadcast` function reference is registered via
//     on(name, broadcast) once per CANONICAL_EVENTS name. on() dedupes by fn
//     reference (registry.mjs), so even if ensureStreamRegistered() were
//     somehow invoked twice, it would be a harmless no-op.
//   - broadcast() fans an event out to every current subscriber. A single
//     subscriber whose write() throws (e.g. broken pipe on a dead HTTP
//     connection) is caught and skipped — it must NEVER escape broadcast(),
//     because dispatch() in src/events/bus.mjs awaits handlers sequentially:
//     an uncaught throw here would break dispatch for every other handler
//     registered on that same event name (real business handlers) and make
//     emit() reject.

import { on } from "../events/registry.mjs";
import { CANONICAL_EVENTS } from "../events/canonical.mjs";

const _subscribers = new Map(); // id -> { write(chunk), filter: Set<string>|null }
let _nextId = 1;
let _registered = false;

// formatSSE — standard SSE wire format: `id: ..\nevent: ..\ndata: ..\n\n`.
// The JSON payload carries everything a dashboard client needs to render the
// event without a follow-up fetch: event id/name, org/client scoping, the
// full event payload, and a broadcast-time timestamp (the in-process event
// object handed to handlers has no timestamp field — created_at is a DB
// column only — so we capture one here, at observe time).
function formatSSE(event) {
  const data = {
    id: event.id,
    name: event.name,
    org_id: event.orgId,
    client_id: event.clientId ?? null,
    payload: event.payload,
    observed_at: new Date().toISOString(),
  };
  return `id: ${event.id}\nevent: ${event.name}\ndata: ${JSON.stringify(data)}\n\n`;
}

// broadcast — the single shared handler registered on every canonical event
// name. MUST NEVER THROW: each subscriber write is individually try/caught so
// one dead subscriber can never break dispatch() for other handlers or other
// subscribers.
export function broadcast(event) {
  const chunk = formatSSE(event);
  for (const sub of _subscribers.values()) {
    if (sub.filter && !sub.filter.has(event.name)) continue;
    try {
      sub.write(chunk);
    } catch {
      // Dead/broken subscriber connection (e.g. broken pipe). Skip it — do
      // NOT remove it from the map here; that's the transport layer's job
      // when the underlying connection actually closes (see api/stream.mjs's
      // req.on('close', unsubscribe)).
    }
  }
}

// ensureStreamRegistered — idempotent. Registers the SAME `broadcast`
// reference for every canonical event name exactly once (mirrors
// src/register-all.mjs's ensureRegistered() idiom). Safe to call repeatedly;
// subscribe() calls this internally so callers never have to think about
// registration order.
export function ensureStreamRegistered() {
  if (_registered) return;
  for (const name of CANONICAL_EVENTS) on(name, broadcast);
  _registered = true;
}

// subscribe(write, { events }) — register a new SSE subscriber.
//   write(chunk: string) — called with a raw SSE text chunk per delivered event.
//   events — optional array of event names to filter to server-side; if
//   omitted/empty, the subscriber receives every canonical event.
// Returns unsubscribe(): removes this subscriber from the Map.
export function subscribe(write, { events } = {}) {
  ensureStreamRegistered();
  const id = _nextId++;
  const filter = events && events.length ? new Set(events) : null;
  _subscribers.set(id, { write, filter });
  return () => {
    _subscribers.delete(id);
  };
}

// Test helper — subscriber-count getter. Public surface is otherwise kept to
// subscribe() (+ ensureStreamRegistered()/broadcast() for completeness/tests).
export const _subscriberCount = () => _subscribers.size;

// Handler registry — maps event name → handlers. Adapters/workflow ports register
// here (Spec §4: "handlers react"). Kept tiny + dependency-free so the bus and
// tests share one source of truth.

const _registry = new Map(); // name -> Set<fn>

// on(name, fn) — register a handler for an event. Returns an unsubscribe fn.
export function on(name, fn) {
  if (!_registry.has(name)) _registry.set(name, new Set());
  _registry.get(name).add(fn);
  return () => _registry.get(name)?.delete(fn);
}

export function getHandlers(name) {
  return _registry.has(name) ? [..._registry.get(name)] : [];
}

export function clearHandlers() {
  _registry.clear();
}

// Item-level repair metrics.

export function deletionRate(items = []) {
  const disputed = items.length;
  if (!disputed) return { disputed: 0, deleted: 0, rate: null };
  const deleted = items.filter((i) => i.status === "deleted" || i.outcome === "deleted").length;
  return { disputed, deleted, rate: deleted / disputed };
}

export function deletionsByRuleId(items = []) {
  const map = new Map();
  for (const it of items) {
    const id = it.rule_id || it.ruleId;
    if (!id) continue;
    const row = map.get(id) || { ruleId: id, disputed: 0, deleted: 0 };
    row.disputed++;
    if (it.status === "deleted" || it.outcome === "deleted") row.deleted++;
    map.set(id, row);
  }
  return [...map.values()].map((r) => ({ ...r, rate: r.disputed ? r.deleted / r.disputed : null }));
}

export function daysToFirstDeletion(items = [], enrolledAt) {
  const deleted = items
    .filter((i) => (i.status === "deleted" || i.outcome === "deleted") && i.updated_at)
    .map((i) => new Date(i.updated_at).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!deleted.length || !enrolledAt) return null;
  const start = new Date(enrolledAt).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Math.round((deleted[0] - start) / 86400000));
}

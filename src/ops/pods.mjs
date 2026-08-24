// A pod is one closer and one funding advisor working in tandem.
// The belt only moves if both seats move. Do not hire one without the other.
//
// Seat counts come from active staff. Named client pods (custom_fields.pod_name)
// stay on F-01. This module does not invent a staff pairing table.

export function podsFromCounts({ closerCount, faCount } = {}) {
  const closers = Number(closerCount);
  const fas = Number(faCount);
  const closer_count = Number.isFinite(closers) && closers > 0 ? closers : 0;
  const fa_count = Number.isFinite(fas) && fas > 0 ? fas : 0;
  const complete = Math.min(closer_count, fa_count);
  const unpaired_closers = Math.max(0, closer_count - complete);
  const unpaired_fas = Math.max(0, fa_count - complete);
  let complete_with = null;
  if (unpaired_closers > 0) complete_with = "funding_advisor";
  else if (unpaired_fas > 0) complete_with = "closer";
  return {
    closer_count,
    fa_count,
    complete,
    unpaired_closers,
    unpaired_fas,
    complete_with,
    tandem: complete > 0 && unpaired_closers === 0 && unpaired_fas === 0
  };
}

/** Company bar = per-pod bar × complete pods, or one pod's worth if none exist yet. */
export function companyBarFromPods(perPod, pods) {
  const n = Number(perPod);
  if (!Number.isFinite(n) || n <= 0) return null;
  const complete = pods?.complete;
  const podsN = Number.isFinite(complete) && complete > 0 ? complete : 1;
  return n * podsN;
}

export async function loadPods(db, { orgId } = {}) {
  if (!orgId) throw new Error("loadPods: orgId is required");
  const { rows } = await db.query(
    `SELECT role, count(*)::int AS n
       FROM staff
      WHERE org_id = $1
        AND role IN ('closer', 'funding_advisor')
        AND lower(coalesce(status, 'active')) = 'active'
      GROUP BY role`,
    [orgId]
  );
  let closerCount = 0;
  let faCount = 0;
  for (const r of rows || []) {
    if (r.role === "closer") closerCount = Number(r.n) || 0;
    if (r.role === "funding_advisor") faCount = Number(r.n) || 0;
  }
  return podsFromCounts({ closerCount, faCount });
}

export default { podsFromCounts, companyBarFromPods, loadPods };

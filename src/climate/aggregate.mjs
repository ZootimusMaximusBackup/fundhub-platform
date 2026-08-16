import { STATE_CENTROIDS, STATE_FIPS, STATE_NAMES, nowIso } from "./config.mjs";
import { pullBls, pullFdic, pullFred, pullFundhub } from "./connectors.mjs";
import { computeBankScore, computeNational, computeStateScore } from "./scoring.mjs";

let memo = null;
let memoAt = 0;
const MEMO_MS = 15 * 60 * 1000;

function stableBankId(bank) {
  return `${String(bank.state_code || "xx").toLowerCase()}-${bank.institution_id}`;
}

export async function buildComposite(force = false) {
  if (!force && memo && Date.now() - memoAt < MEMO_MS) return memo;
  const asOf = nowIso();
  const [fred, bls, fdicRaw] = await Promise.all([pullFred(), pullBls(), pullFdic()]);
  const fdic = fdicRaw
    ? { ...fdicRaw, banks: (fdicRaw.banks || []).map((b) => ({ ...b, bank_id: stableBankId(b) })) }
    : fdicRaw;
  const national = computeNational(fred);
  const internalOutcomes = await pullFundhub(fdic?.banks || []);
  const outcomesByBank = new Map((internalOutcomes.outcomes || []).map((o) => [o.bank_id, o]));
  const banks = (fdic?.banks || []).map((bank) => {
    const bank_id = stableBankId(bank);
    const scored = computeBankScore(bank, outcomesByBank.get(bank_id), national.score, []);
    const centroid = STATE_CENTROIDS[bank.state_code] || { lat: null, lng: null };
    return {
      id: bank_id,
      name: bank.legal_name,
      state: bank.state_code,
      city: bank.city,
      score: scored.score,
      trend_30d: scored.trend_30d,
      type: "bank",
      location: { lat: centroid.lat, lng: centroid.lng },
      fundamentals: scored.fundamentals,
      issuance: scored.issuance,
      internal_outcomes: scored.internal_outcomes,
      stale: Boolean(fdic?.stale)
    };
  });
  const blsMap = new Map((bls?.states || []).map((e) => [e.state_code, e]));
  const states = Object.keys(STATE_FIPS).map((stateCode) => {
    const entry = blsMap.get(stateCode) || {
      state_code: stateCode,
      unemployment_rate_pct: 4.5,
      delinquency_rate_pct: 1.5
    };
    const scored = computeStateScore(entry, banks, national.nfib_index, []);
    return {
      ...scored,
      name: STATE_NAMES[stateCode] || stateCode,
      updated_at: asOf,
      stale: Boolean(bls?.stale)
    };
  });
  const payload = {
    as_of: asOf,
    stale: Boolean(fred?.stale || bls?.stale || fdic?.stale),
    national: {
      score: national.score,
      components: national.components,
      color_band: national.color_band,
      color: national.color,
      title: national.title,
      updated_at: national.updated_at,
      stale: Boolean(national.stale)
    },
    states,
    banks,
    sources: {
      fred: fred?.fetch_status,
      bls: bls?.fetch_status,
      fdic: fdic?.fetch_status
    }
  };
  memo = payload;
  memoAt = Date.now();
  return payload;
}

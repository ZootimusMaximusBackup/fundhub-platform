import {
  STATE_CENTROIDS,
  STATE_FIPS,
  blsKey,
  computeTtlExpiry,
  fredKey,
  isExpired,
  mapsServerKey,
  nowIso
} from "./config.mjs";

const memory = new Map();

export async function getCached(key, now = new Date()) {
  const entry = memory.get(key);
  if (!entry) return { entry: null, expired: true };
  return { entry, expired: isExpired(entry.ttl_expires_at, now) };
}

export async function setCached(key, entry) {
  memory.set(key, entry);
  return entry;
}

function withTimeout(ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(id) };
}

const FRED_SERIES = [
  { id: "DGS10", cadence: "daily", fallback: 4.0 },
  { id: "EFFR", cadence: "daily", fallback: 5.0, alt: "FEDFUNDS" },
  { id: "BAMLC0A4CBBBEY", cadence: "daily", fallback: 5.5 },
  { id: "CPIAUCSL", cadence: "monthly", fallback: 3.0, compute: "yoy", limit: 14 },
  { id: "UMCSENT", cadence: "monthly", fallback: 70 },
  { id: "NFIBBUSI", cadence: "monthly", fallback: 95 }
];

async function fetchFredObservation(target) {
  const key = fredKey();
  const { id, alt, compute, limit = compute === "yoy" ? 14 : 1 } = target;
  const { signal, cancel } = withTimeout(6000);
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=${limit}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`FRED ${id} ${res.status}`);
    const json = await res.json();
    const observations = json.observations || [];
    if (!observations.length && alt) return fetchFredObservation({ ...target, id: alt, alt: null });
    if (compute === "yoy" && observations.length >= 13) {
      const latest = parseFloat(observations[0].value);
      const prior = parseFloat(observations[12].value);
      const yoy = prior ? ((latest - prior) / prior) * 100 : latest;
      return { series_id: id, observations: [{ date: observations[0].date, value: yoy }] };
    }
    const obs = observations[0];
    if (!obs) throw new Error(`FRED ${id} empty`);
    return { series_id: id, observations: [{ date: obs.date, value: parseFloat(obs.value) }] };
  } finally {
    cancel();
  }
}

export async function pullFred() {
  const now = nowIso();
  const series = {};
  let stale = false;
  for (const target of FRED_SERIES) {
    const cacheKey = `connector:fred:${target.id}`;
    const { entry: cached, expired } = await getCached(cacheKey);
    const ttl_expires_at = computeTtlExpiry(now, target.cadence);
    let record = cached;
    if (!cached || expired) {
      try {
        if (!fredKey()) throw new Error("FRED_API_KEY unset");
        const fetched = await fetchFredObservation(target);
        record = { ...fetched, updated_at: now, ttl_expires_at, fetch_status: "fetched", stale: false };
        await setCached(cacheKey, record);
      } catch {
        record = cached
          ? { ...cached, stale: true, fetch_status: "lkg" }
          : {
            series_id: target.id,
            observations: [{ date: now, value: target.fallback }],
            updated_at: now,
            ttl_expires_at,
            fetch_status: "fallback",
            stale: true
          };
        stale = true;
        if (!cached) await setCached(cacheKey, record);
      }
    } else {
      record = { ...record, stale: false, fetch_status: "cache" };
    }
    series[target.id] = record;
  }
  return { updated_at: now, fetch_status: stale ? "fallback" : "fetched", series, stale };
}

export async function pullBls(states = Object.keys(STATE_FIPS)) {
  const now = nowIso();
  const cacheKey = "connector:bls:laus";
  const { entry: cached, expired } = await getCached(cacheKey);
  const ttl_expires_at = computeTtlExpiry(now, "monthly");
  if (cached && !expired) return { ...cached, stale: false, fetch_status: "cache" };
  try {
    const payload = {
      seriesid: states.map((code) => `LAUST${STATE_FIPS[code]}0000000003`).filter(Boolean)
    };
    if (blsKey()) payload.registrationkey = blsKey();
    const { signal, cancel } = withTimeout(8000);
    const res = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal
    });
    cancel();
    if (!res.ok) throw new Error(`BLS ${res.status}`);
    const json = await res.json();
    const entries = (json.Results?.series || []).flatMap((seriesEntry) => {
      const stateFips = seriesEntry.seriesID.slice(5, 7);
      const state = Object.entries(STATE_FIPS).find(([, f]) => f === stateFips)?.[0];
      const value = parseFloat(seriesEntry.data?.[0]?.value);
      if (!state) return [];
      return [{ state_code: state, unemployment_rate_pct: Number.isFinite(value) ? value : null, date: now }];
    });
    if (!entries.length) throw new Error("BLS empty");
    const record = { updated_at: now, ttl_expires_at, states: entries, fetch_status: "fetched", stale: false };
    await setCached(cacheKey, record);
    return record;
  } catch {
    if (cached) return { ...cached, stale: true, fetch_status: "lkg" };
    const fallbackStates = states.map((state, idx) => ({
      state_code: state,
      unemployment_rate_pct: Number((3 + (idx % 5) * 0.4).toFixed(1)),
      date: now
    }));
    const fallback = { updated_at: now, ttl_expires_at, states: fallbackStates, fetch_status: "fallback", stale: true };
    await setCached(cacheKey, fallback);
    return fallback;
  }
}

function mapFdicRow(row) {
  const r = row.data || row;
  return {
    institution_id: String(r.UNINUM || r.CERT || r.IDRSSD || r.NAME),
    legal_name: r.NAME,
    state_code: r.STALP,
    city: r.CITY,
    zip: r.ZIP,
    total_deposits: Number.parseFloat(r.DEP),
    cds_balance: Number.parseFloat(r.TCD || 0) || null,
    total_assets: Number.parseFloat(r.ASSET),
    net_interest_margin: Number.parseFloat(r.NIMY || r.NIMYTD || 0) || null,
    location: null
  };
}

export async function pullFdic(limit = 50) {
  const now = nowIso();
  const cacheKey = "connector:fdic:institutions";
  const { entry: cached, expired } = await getCached(cacheKey);
  const ttl_expires_at = computeTtlExpiry(now, "quarterly");
  if (cached && !expired) return { ...cached, stale: false, fetch_status: "cache" };
  try {
    const fields = ["UNINUM", "CERT", "IDRSSD", "NAME", "STALP", "CITY", "ZIP", "ASSET", "DEP", "NIMY", "NIMYTD"].join(",");
    const url = `https://banks.data.fdic.gov/api/institutions?filters=ACTIVE%3A1&fields=${fields}&sort_by=ASSET&sort_order=desc&limit=${limit}`;
    const { signal, cancel } = withTimeout(8000);
    const res = await fetch(url, { signal });
    cancel();
    if (!res.ok) throw new Error(`FDIC ${res.status}`);
    const json = await res.json();
    const banks = (json.data || []).map(mapFdicRow).filter((b) => b.state_code);
    const record = { updated_at: now, ttl_expires_at, banks, fetch_status: "fetched", stale: false };
    await setCached(cacheKey, record);
    return record;
  } catch {
    if (cached) return { ...cached, stale: true, fetch_status: "lkg" };
    const banks = [
      { institution_id: "1001", legal_name: "Desert First Bank", state_code: "AZ", city: "Phoenix", total_deposits: 1.25e9, cds_balance: 3.2e8, total_assets: 2.1e9, net_interest_margin: 3.1, location: null },
      { institution_id: "2001", legal_name: "Pacific Horizon Bank", state_code: "CA", city: "Los Angeles", total_deposits: 2.25e9, cds_balance: 4.5e8, total_assets: 4e9, net_interest_margin: 2.9, location: null },
      { institution_id: "4001", legal_name: "Lone Star National", state_code: "TX", city: "Austin", total_deposits: 1.4e9, cds_balance: 3e8, total_assets: 2.5e9, net_interest_margin: 3.3, location: null }
    ];
    const record = { updated_at: now, ttl_expires_at, banks, fetch_status: "fallback", stale: true };
    await setCached(cacheKey, record);
    return record;
  }
}

function seededNumber(seed, min, max) {
  const normalized = (Math.sin(seed) + 1) / 2;
  return min + normalized * (max - min);
}

export async function pullFundhub(banks = []) {
  const now = nowIso();
  const outcomes = banks.map((bank) => {
    const seed = parseInt(String(bank.institution_id || "1").replace(/\D/g, "").slice(-4) || "1", 10);
    const loan_volume_30d = Math.round(seededNumber(seed + 17, 20_000_000, 120_000_000));
    const prior = Math.round(seededNumber(seed + 23, 20_000_000, 120_000_000));
    const direction = loan_volume_30d > prior * 1.05 ? 1 : loan_volume_30d < prior * 0.95 ? -1 : 0;
    const raw = [Math.abs(seed * 1.1), Math.abs(seed * 1.3), Math.abs(seed * 1.7)];
    const total = raw.reduce((a, b) => a + b, 0) || 1;
    const [card, loc, term] = raw.map((v) => Math.round((v / total) * 100));
    return {
      bank_id: bank.bank_id || bank.institution_id,
      approval_rate: Number(seededNumber(seed, 0.45, 0.85).toFixed(3)),
      avg_limit: Math.round(seededNumber(seed + 11, 8000, 22000)),
      issuance: {
        gross_amount_recent_window: Math.round(seededNumber(seed + 5, 10_000_000, 80_000_000)),
        mix: { card, loc, term },
        direction
      }
    };
  });
  return { updated_at: now, outcomes, fetch_status: "generated", stale: false };
}

function stateFromText(query) {
  const upper = String(query || "").toUpperCase();
  const match = upper.match(/\b([A-Z]{2})\b/);
  if (match && STATE_CENTROIDS[match[1]]) return match[1];
  for (const [code, name] of Object.entries({
    ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA",
    COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA",
    HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA", KANSAS: "KS",
    KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD", MASSACHUSETTS: "MA",
    MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT",
    NEBRASKA: "NE", NEVADA: "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",
    "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND",
    OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI",
    "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX",
    UTAH: "UT", VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV",
    WISCONSIN: "WI", WYOMING: "WY"
  })) {
    if (upper.includes(code)) return name;
  }
  return null;
}

async function geocodeGoogle(query) {
  const key = mapsServerKey();
  if (!key) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&components=country:US&key=${encodeURIComponent(key)}`;
  const { signal, cancel } = withTimeout(6000);
  try {
    const res = await fetch(url, { signal });
    cancel();
    if (!res.ok) return null;
    const json = await res.json();
    const hit = json.results?.[0];
    if (!hit) return null;
    const stateComp = (hit.address_components || []).find((c) => c.types.includes("administrative_area_level_1"));
    const stateCode = stateComp?.short_name;
    return {
      ok: true,
      provider: "google",
      stateCode: STATE_CENTROIDS[stateCode] ? stateCode : stateFromText(query),
      lat: hit.geometry?.location?.lat,
      lng: hit.geometry?.location?.lng,
      formatted: hit.formatted_address
    };
  } catch {
    cancel();
    return null;
  }
}

async function geocodeCensus(query) {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&format=json`;
  const { signal, cancel } = withTimeout(6000);
  try {
    const res = await fetch(url, { signal, headers: { "User-Agent": "fundhub-climate/1.0" } });
    cancel();
    if (!res.ok) return null;
    const json = await res.json();
    const match = json.result?.addressMatches?.[0];
    if (!match) return null;
    const stateCode = match.addressComponents?.state;
    return {
      ok: true,
      provider: "census",
      stateCode: STATE_CENTROIDS[stateCode] ? stateCode : stateFromText(query),
      lat: match.coordinates?.y,
      lng: match.coordinates?.x,
      formatted: match.matchedAddress
    };
  } catch {
    cancel();
    return null;
  }
}

export async function geocode(query) {
  const q = String(query || "").trim();
  if (!q) return null;
  const exact = q.toUpperCase();
  if (STATE_CENTROIDS[exact]) {
    return { ok: true, provider: "centroid", stateCode: exact, ...STATE_CENTROIDS[exact] };
  }
  const cacheKey = `geocode:${q.toLowerCase()}`;
  const cached = memory.get(cacheKey);
  if (cached) return cached;
  const google = await geocodeGoogle(q);
  const census = google || await geocodeCensus(q);
  const stateCode = census?.stateCode || stateFromText(q);
  const fallback = stateCode && STATE_CENTROIDS[stateCode]
    ? { ok: true, provider: census?.provider || "centroid", stateCode, ...STATE_CENTROIDS[stateCode] }
    : null;
  const result = census?.lat ? census : fallback;
  if (result) memory.set(cacheKey, result);
  return result;
}

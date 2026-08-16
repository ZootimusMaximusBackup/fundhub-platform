const DAY_MS = 24 * 60 * 60 * 1000;

export const STATE_FIPS = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11",
  FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21",
  LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30",
  NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39",
  OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48", UT: "49",
  VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56"
};

export const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
};

export const STATE_CENTROIDS = {
  AL: { lat: 32.806671, lng: -86.79113 }, AK: { lat: 61.370716, lng: -152.404419 },
  AZ: { lat: 33.729759, lng: -111.431221 }, AR: { lat: 34.969704, lng: -92.373123 },
  CA: { lat: 36.116203, lng: -119.681564 }, CO: { lat: 39.059811, lng: -105.311104 },
  CT: { lat: 41.597782, lng: -72.755371 }, DE: { lat: 39.318523, lng: -75.507141 },
  FL: { lat: 27.766279, lng: -81.686783 }, GA: { lat: 33.040619, lng: -83.643074 },
  HI: { lat: 21.094318, lng: -157.498337 }, ID: { lat: 44.240459, lng: -114.478828 },
  IL: { lat: 40.349457, lng: -88.986137 }, IN: { lat: 39.849426, lng: -86.258278 },
  IA: { lat: 42.011539, lng: -93.210526 }, KS: { lat: 38.5266, lng: -96.726486 },
  KY: { lat: 37.66814, lng: -84.670067 }, LA: { lat: 31.169546, lng: -91.867805 },
  ME: { lat: 44.693947, lng: -69.381927 }, MD: { lat: 39.063946, lng: -76.802101 },
  MA: { lat: 42.230171, lng: -71.530106 }, MI: { lat: 43.326618, lng: -84.536095 },
  MN: { lat: 45.694454, lng: -93.900192 }, MS: { lat: 32.741646, lng: -89.678696 },
  MO: { lat: 38.456085, lng: -92.288368 }, MT: { lat: 46.921925, lng: -110.454353 },
  NE: { lat: 41.12537, lng: -98.268082 }, NV: { lat: 38.313515, lng: -117.055374 },
  NH: { lat: 43.452492, lng: -71.563896 }, NJ: { lat: 40.298904, lng: -74.521011 },
  NM: { lat: 34.840515, lng: -106.248482 }, NY: { lat: 42.165726, lng: -74.948051 },
  NC: { lat: 35.630066, lng: -79.806419 }, ND: { lat: 47.528912, lng: -99.784012 },
  OH: { lat: 40.388783, lng: -82.764915 }, OK: { lat: 35.565342, lng: -96.928917 },
  OR: { lat: 44.572021, lng: -122.070938 }, PA: { lat: 40.590752, lng: -77.209755 },
  RI: { lat: 41.680893, lng: -71.51178 }, SC: { lat: 33.856892, lng: -80.945007 },
  SD: { lat: 44.299782, lng: -99.438828 }, TN: { lat: 35.747845, lng: -86.692345 },
  TX: { lat: 31.054487, lng: -97.563461 }, UT: { lat: 40.150032, lng: -111.862434 },
  VT: { lat: 44.045876, lng: -72.710686 }, VA: { lat: 37.769337, lng: -78.169968 },
  WA: { lat: 47.400902, lng: -121.490494 }, WV: { lat: 38.491226, lng: -80.954453 },
  WI: { lat: 44.268543, lng: -89.616508 }, WY: { lat: 42.755966, lng: -107.30249 },
  DC: { lat: 38.905985, lng: -77.033418 }
};

export const BANDS = [
  { min: 80, label: "very_favorable", title: "Very favorable", color: "#A8D8B0" },
  { min: 65, label: "favorable", title: "Favorable", color: "#A9C6E8" },
  { min: 50, label: "neutral", title: "Neutral", color: "#F2E39B" },
  { min: 35, label: "tight", title: "Tight", color: "#F5CE8F" },
  { min: 0, label: "very_tight", title: "Very tight", color: "#F2A69B" }
];

export const WEIGHTS = {
  national: {
    fed_policy: 0.22,
    inflation: 0.20,
    credit_spreads: 0.18,
    systemic_risk: 0.18,
    consumer_sentiment: 0.12,
    nfib: 0.10
  },
  business_conditions: { nfib: 0.34, unemployment: 0.33, delinquency: 0.33 },
  state: {
    business_conditions: 0.4,
    issuance_velocity: 0.25,
    liquidity_score: 0.2,
    approval_odds: 0.15
  },
  bank: {
    composite: { fundamentals: 0.45, issuance: 0.25, internal_outcomes: 0.20, macro_overlay: 0.10 },
    fundamentals: { deposits_cds: 0.4, spreads: 0.3, cd_growth: 0.3 },
    issuance: { direction: 0.4, gross: 0.3, mix: 0.3 }
  }
};

export const NORMALIZATION = {
  fred: {
    fed_policy: { min: 0, max: 7, invert: true },
    inflation: { min: 0, max: 9, invert: true },
    credit_spreads: { min: 0.5, max: 4, invert: true },
    systemic_risk: { min: 0.5, max: 4, invert: true },
    consumer_sentiment: { min: 50, max: 110, invert: false },
    nfib: { min: 80, max: 110, invert: false }
  },
  state: {
    unemployment_rate_pct: { min: 2, max: 12, invert: true },
    delinquency_rate_pct: { min: 0, max: 8, invert: true }
  },
  bank: {
    deposits_to_assets: { min: 0.5, max: 1.2, invert: false },
    net_interest_margin: { min: 1, max: 6, invert: false },
    cd_growth_pct: { min: -5, max: 20, invert: false },
    approval_rate: { min: 0, max: 1, invert: false },
    issuance_direction: { min: -1, max: 1, invert: false },
    issuance_gross: { min: 0, max: 500_000_000, invert: false }
  }
};

export const CADENCE_TTL_MS = {
  daily: DAY_MS,
  monthly: 35 * DAY_MS,
  quarterly: 95 * DAY_MS
};

export function bandFromScore(score) {
  const entry = BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1];
  return { color_band: entry.label, color: entry.color, title: entry.title };
}

export function normalize(value, min, max, invert = false) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 50;
  if (min === max) return 50;
  const ratio = Math.min(1, Math.max(0, (Number(value) - min) / (max - min)));
  const norm = invert ? 1 - ratio : ratio;
  return Math.max(0, Math.min(100, Math.round(norm * 100)));
}

export function normalizeFromConfig(value, cfg = {}) {
  return normalize(value, cfg.min ?? 0, cfg.max ?? 100, Boolean(cfg.invert));
}

export function weightedComposite(scores = {}, weights = {}, digits = 1) {
  const entries = Object.entries(weights);
  if (!entries.length) return 0;
  const weightSum = entries.reduce((acc, [, w]) => acc + (w || 0), 0) || 1;
  const total = entries.reduce((acc, [key, weight]) => {
    const value = scores[key];
    return acc + (Number.isFinite(value) ? value * ((weight || 0) / weightSum) : 0);
  }, 0);
  const factor = 10 ** digits;
  return Math.round(total * factor) / factor;
}

export function nowIso() {
  return new Date().toISOString();
}

export function computeTtlExpiry(updatedAt, cadence) {
  const ms = CADENCE_TTL_MS[cadence] || CADENCE_TTL_MS.daily;
  return new Date(new Date(updatedAt).getTime() + ms).toISOString();
}

export function isExpired(ttlIso, now = new Date()) {
  if (!ttlIso) return true;
  return new Date(ttlIso).getTime() <= now.getTime();
}

export function mapsBrowserKey() {
  return String(process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_MAPS_API_KEY || "").trim();
}

export function mapsServerKey() {
  return String(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_BROWSER_KEY || "").trim();
}

export function fredKey() {
  return String(process.env.FRED_API_KEY || "").trim();
}

export function blsKey() {
  return String(process.env.BLS_API_KEY || "").trim();
}

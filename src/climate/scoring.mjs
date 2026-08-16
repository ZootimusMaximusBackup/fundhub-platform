import { NORMALIZATION, WEIGHTS, bandFromScore, normalizeFromConfig, weightedComposite } from "./config.mjs";

export function computeTrendDelta(currentScore, history = [], threshold = 5) {
  if (!history.length || currentScore == null) return { delta: null, label: "flat" };
  const avg = history.reduce((acc, entry) => acc + (entry.score || 0), 0) / history.length;
  const delta = currentScore - avg;
  const label = delta >= threshold ? "up" : delta <= -threshold ? "down" : "flat";
  return { delta, label };
}

export function computeNational(fredConnector) {
  const series = fredConnector?.series || {};
  const latest = (id) => {
    const obs = series[id]?.observations?.[0];
    return obs ? Number.parseFloat(obs.value) : null;
  };
  const fed = latest("EFFR") ?? latest("FEDFUNDS");
  const inflation = latest("CPIAUCSL");
  const bbb = latest("BAMLC0A4CBBBEY");
  const treasury10Y = latest("DGS10");
  const spread = bbb != null && treasury10Y != null ? bbb - treasury10Y : bbb;
  const systemic = spread ?? bbb ?? treasury10Y;
  const consumerSentiment = latest("UMCSENT");
  const nfib = latest("NFIBBUSI") ?? 95;
  const components = {
    fed_policy: normalizeFromConfig(fed, NORMALIZATION.fred.fed_policy),
    inflation: normalizeFromConfig(inflation, NORMALIZATION.fred.inflation),
    credit_spreads: normalizeFromConfig(spread, NORMALIZATION.fred.credit_spreads),
    systemic_risk: normalizeFromConfig(systemic, NORMALIZATION.fred.systemic_risk),
    consumer_sentiment: normalizeFromConfig(consumerSentiment, NORMALIZATION.fred.consumer_sentiment),
    nfib: normalizeFromConfig(nfib, NORMALIZATION.fred.nfib)
  };
  const score = weightedComposite(components, WEIGHTS.national, 1);
  const band = bandFromScore(score);
  return {
    score,
    components,
    nfib_index: nfib,
    color_band: band.color_band,
    color: band.color,
    title: band.title,
    updated_at: fredConnector?.updated_at,
    stale: Boolean(fredConnector?.stale)
  };
}

export function computeBusinessConditions({ nfibIndex, unemployment_rate_pct, delinquency_rate_pct }) {
  return weightedComposite({
    nfib: normalizeFromConfig(nfibIndex, NORMALIZATION.fred.nfib),
    unemployment: normalizeFromConfig(unemployment_rate_pct, NORMALIZATION.state.unemployment_rate_pct),
    delinquency: normalizeFromConfig(delinquency_rate_pct, NORMALIZATION.state.delinquency_rate_pct)
  }, WEIGHTS.business_conditions, 1);
}

export function rollupFromBanks(stateCode, banks = []) {
  const relevant = banks.filter((b) => b.state === stateCode);
  if (!relevant.length) {
    return { issuance_velocity: 50, avg_approval_odds: 0.5, liquidity_score: 50 };
  }
  const avgDirection = relevant.reduce((acc, bank) => acc + (bank.issuance?.direction ?? 0), 0) / relevant.length;
  const issuance_velocity = Math.round(((avgDirection + 1) / 2) * 100);
  const avgApproval = relevant.reduce((acc, bank) => acc + (bank.internal_outcomes?.approval_rate ?? 0), 0) / relevant.length;
  const liquidity_score = relevant.reduce((acc, bank) => acc + (bank.fundamentals?.deposits_cds ?? 0), 0) / relevant.length;
  return {
    issuance_velocity,
    avg_approval_odds: Number(avgApproval.toFixed(3)),
    liquidity_score: Math.round(liquidity_score)
  };
}

export function computeStateScore(stateEntry, banks = [], nfibIndex = 95, history = []) {
  const business_conditions = computeBusinessConditions({
    nfibIndex,
    unemployment_rate_pct: stateEntry.unemployment_rate_pct,
    delinquency_rate_pct: stateEntry.delinquency_rate_pct ?? 1.0
  });
  const rollup = rollupFromBanks(stateEntry.state_code, banks);
  const composite = weightedComposite({
    business_conditions,
    issuance_velocity: rollup.issuance_velocity,
    liquidity_score: rollup.liquidity_score,
    approval_odds: normalizeFromConfig(rollup.avg_approval_odds, NORMALIZATION.bank.approval_rate)
  }, WEIGHTS.state, 1);
  const band = bandFromScore(composite);
  return {
    state: stateEntry.state_code,
    score: composite,
    business_conditions,
    issuance_velocity: rollup.issuance_velocity,
    avg_approval_odds: rollup.avg_approval_odds,
    liquidity_score: rollup.liquidity_score,
    trend_30d: computeTrendDelta(composite, history).label,
    color_band: band.color_band,
    color: band.color,
    title: band.title
  };
}

export function computeBankScore(bank, internalOutcome, macroOverlay, history = []) {
  const depositsToAssets = bank.total_deposits && bank.total_assets ? bank.total_deposits / bank.total_assets : null;
  const deposits_cds = normalizeFromConfig(depositsToAssets, NORMALIZATION.bank.deposits_to_assets);
  const spreads = normalizeFromConfig(bank.net_interest_margin, NORMALIZATION.bank.net_interest_margin);
  const cd_growth = normalizeFromConfig(bank.cds_balance, NORMALIZATION.bank.cd_growth_pct);
  const fundamentalsScore = weightedComposite({ deposits_cds, spreads, cd_growth }, WEIGHTS.bank.fundamentals, 1);
  const issuanceRaw = internalOutcome?.issuance || {};
  const directionScore = normalizeFromConfig(issuanceRaw.direction, NORMALIZATION.bank.issuance_direction);
  const grossScore = normalizeFromConfig(issuanceRaw.gross_amount_recent_window, NORMALIZATION.bank.issuance_gross);
  const mix = issuanceRaw.mix || { card: 33, loc: 33, term: 34 };
  const mixValues = Object.values(mix);
  const mixScore = mixValues.length ? Math.max(0, Math.min(100, Math.round(100 - (Math.max(...mixValues) - Math.min(...mixValues))))) : 50;
  const issuanceScore = weightedComposite({
    direction: directionScore,
    gross: grossScore,
    mix: mixScore
  }, WEIGHTS.bank.issuance, 1);
  const internalScore = normalizeFromConfig(internalOutcome?.approval_rate ?? 0.5, NORMALIZATION.bank.approval_rate);
  const score = weightedComposite({
    fundamentals: fundamentalsScore,
    issuance: issuanceScore,
    internal_outcomes: internalScore,
    macro_overlay: macroOverlay
  }, WEIGHTS.bank.composite, 1);
  return {
    score,
    trend_30d: computeTrendDelta(score, history).label,
    fundamentals: { deposits_cds, spreads, cd_growth },
    issuance: {
      gross: issuanceRaw.gross_amount_recent_window ?? null,
      mix: issuanceRaw.mix || { card: 0, loc: 0, term: 0 },
      direction: issuanceRaw.direction ?? 0
    },
    internal_outcomes: {
      approval_rate: internalOutcome?.approval_rate ?? 0.5,
      avg_limit: internalOutcome?.avg_limit ?? null
    }
  };
}

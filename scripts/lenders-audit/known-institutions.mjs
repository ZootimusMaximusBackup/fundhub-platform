/**
 * Canonical institution metadata: domain + preferred business CC apply URL.
 * Keys are lowercase normalized names or slug aliases.
 */

export const KNOWN_INSTITUTIONS = Object.freeze({
  chase: {
    display: "Chase",
    domain: "chase.com",
    applyUrl: "https://www.chase.com/business/credit-cards"
  },
  "chase bank": {
    display: "Chase",
    domain: "chase.com",
    applyUrl: "https://www.chase.com/business/credit-cards"
  },
  "american express": {
    display: "American Express",
    domain: "americanexpress.com",
    applyUrl: "https://www.americanexpress.com/us/credit-cards/business/"
  },
  amex: {
    display: "American Express",
    domain: "americanexpress.com",
    applyUrl: "https://www.americanexpress.com/us/credit-cards/business/"
  },
  "bank of america": {
    display: "Bank of America",
    domain: "bankofamerica.com",
    applyUrl: "https://www.bankofamerica.com/smallbusiness/credit-cards/"
  },
  "wells fargo": {
    display: "Wells Fargo",
    domain: "wellsfargo.com",
    applyUrl: "https://www.wellsfargo.com/biz/business-credit/credit-cards/"
  },
  citi: {
    display: "Citi",
    domain: "citi.com",
    applyUrl: "https://www.citi.com/credit-cards/compare/business-credit-cards"
  },
  "capital one": {
    display: "Capital One",
    domain: "capitalone.com",
    applyUrl: "https://www.capitalone.com/small-business/credit-cards/"
  },
  truist: {
    display: "Truist",
    domain: "truist.com",
    applyUrl: "https://www.truist.com/small-business/credit-cards/business-card"
  },
  "us bank": {
    display: "US Bank",
    domain: "usbank.com",
    applyUrl: "https://creditcardapply.usbank.com/cc/landing"
  },
  "pnc bank": {
    display: "PNC Bank",
    domain: "pnc.com",
    applyUrl: "https://www.pnc.com/en/small-business/borrowing/business-credit-cards.html"
  },
  "bmo harris": {
    display: "BMO Harris",
    domain: "bmoharris.com",
    applyUrl: "https://www.bmoharris.com/main/business-banking/credit-cards/"
  },
  "first citizens bank": {
    display: "First Citizens Bank",
    domain: "firstcitizens.com",
    applyUrl: "https://www.firstcitizens.com/small-business/credit-financing/credit-cards/premium-rewards"
  },
  "first citizens": {
    display: "First Citizens Bank",
    domain: "firstcitizens.com",
    applyUrl: "https://www.firstcitizens.com/small-business/credit-financing/credit-cards/premium-rewards"
  },
  "citizens bank": {
    display: "Citizens Bank",
    domain: "citizensbank.com",
    applyUrl: "https://www.citizensbank.com/small-business/credit-cards.aspx"
  },
  fnbo: {
    display: "FNBO",
    domain: "fnbo.com",
    applyUrl: "https://www.fnbo.com/small-business/credit-cards/evergreen/"
  },
  "fifth third bank": {
    display: "Fifth Third Bank",
    domain: "53.com",
    applyUrl: "https://www.53.com/content/fifth-third/en/business-banking/managing-business/credit-card-solutions.html"
  },
  "fifth third": {
    display: "Fifth Third Bank",
    domain: "53.com",
    applyUrl: "https://www.53.com/content/fifth-third/en/business-banking/managing-business/credit-card-solutions.html"
  },
  keybank: {
    display: "KeyBank",
    domain: "key.com",
    applyUrl: "https://www.key.com/small-business/banking/credit-cards/mastercard-small-business-credit-card.jsp"
  },
  "m&t bank": {
    display: "M&T Bank",
    domain: "mtb.com",
    applyUrl: "https://www3.mtb.com/business/mt-business-credit-card"
  },
  "td bank": {
    display: "TD Bank",
    domain: "td.com",
    applyUrl: "https://www.td.com/us/en/small-business/banking/credit-cards"
  },
  "regions bank": {
    display: "Regions Bank",
    domain: "regions.com",
    applyUrl: "https://www.regions.com/small-business/business-credit-cards"
  },
  "huntington bank": {
    display: "Huntington Bank",
    domain: "huntington.com",
    applyUrl: "https://www.huntington.com/SmallBusiness/voice-business-credit-card"
  },
  "comerica bank": {
    display: "Comerica Bank",
    domain: "comerica.com",
    applyUrl: "https://www.comerica.com/business/banking/cards-online-sevices/business-credit-card.html"
  },
  "santander bank": {
    display: "Santander Bank",
    domain: "santanderbank.com",
    applyUrl: "https://www.santanderbank.com/us/business/credit-cards"
  },
  "valley bank": {
    display: "Valley Bank",
    domain: "valley.com",
    applyUrl: "https://www.valley.com/business/commercial-lending/business-credit-cards"
  },
  "zions bank": {
    display: "Zions Bank",
    domain: "zionsbank.com",
    applyUrl: "https://www.zionsbank.com/business-banking/business-credit-cards/"
  }
});

/** @param {string} name */
export function lookupInstitution(name) {
  const norm = String(name || "").replace(/\s*\([^)]*\)\s*/g, " ").trim().toLowerCase();
  if (KNOWN_INSTITUTIONS[norm]) return KNOWN_INSTITUTIONS[norm];
  for (const [key, meta] of Object.entries(KNOWN_INSTITUTIONS)) {
    if (norm === key || norm.startsWith(key + " ") || norm.endsWith(" " + key)) return meta;
  }
  return null;
}

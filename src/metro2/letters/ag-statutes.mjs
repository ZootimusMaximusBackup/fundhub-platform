// State AG consumer-protection hooks for complaint drafts.
// Not legal advice. Fallback is "search this state's deceptive trade practices act."

export const AG_BY_STATE = Object.freeze({
  TX: Object.freeze({
    stateName: "Texas",
    statute: "Deceptive Trade Practices Act, Tex. Bus. & Com. Code § 17.41 et seq.",
    cites: [
      "Tex. Bus. & Com. Code § 17.46(b)(5) (false representations)",
      "Tex. Bus. & Com. Code § 17.46(b)(7) (misrepresented quality)",
      "Tex. Bus. & Com. Code § 17.50(a)(3) (unconscionable action)"
    ],
    portal: "https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint",
    office: "Office of the Attorney General of Texas, Consumer Protection Division"
  }),
  CA: Object.freeze({
    stateName: "California",
    statute: "Consumer Legal Remedies Act, Cal. Civ. Code § 1750 et seq.",
    cites: ["Cal. Civ. Code § 1750 et seq.", "California Consumer Credit Reporting Agencies Act, Civil Code § 1785.13 et seq."],
    portal: "https://oag.ca.gov/report",
    office: "California Department of Justice, Office of the Attorney General"
  }),
  FL: Object.freeze({
    stateName: "Florida",
    statute: "Deceptive and Unfair Trade Practices Act, Fla. Stat. § 501.201 et seq.",
    cites: ["Fla. Stat. § 501.201 et seq."],
    portal: "https://www.myfloridalegal.com/consumer-protection",
    office: "Florida Attorney General, Consumer Protection"
  }),
  NY: Object.freeze({
    stateName: "New York",
    statute: "New York General Business Law § 349",
    cites: ["N.Y. Gen. Bus. Law § 349", "N.Y. Gen. Bus. Law § 380-j"],
    portal: "https://ag.ny.gov/complaint-forms",
    office: "New York State Office of the Attorney General"
  }),
  IL: Object.freeze({
    stateName: "Illinois",
    statute: "Consumer Fraud and Deceptive Business Practices Act, 815 ILCS 505",
    cites: ["815 ILCS 505"],
    portal: "https://www.illinoisattorneygeneral.gov/consumers/",
    office: "Illinois Attorney General, Consumer Protection"
  })
});

export function agForState(state) {
  const code = String(state || "").trim().toUpperCase();
  if (AG_BY_STATE[code]) return { ...AG_BY_STATE[code], code, known: true };
  const name = code || "your state";
  return {
    code: code || null,
    known: false,
    stateName: name,
    statute: `Search "${name} deceptive trade practices act" and insert the statute citation.`,
    cites: [],
    portal: `Search "${name} attorney general consumer complaint"`,
    office: `${name} Attorney General, Consumer Protection`
  };
}

export const CFPB_FILING = Object.freeze({
  portal: "https://www.consumerfinance.gov/complaint",
  phone: "(855) 411-2372",
  hours: "Mon–Fri 8am–8pm ET",
  mail: "Consumer Financial Protection Bureau, P.O. Box 27170, Washington, DC 20038",
  companyResponseDays: 15
});

export const BUREAU_DISPUTE_ADDRESSES = Object.freeze({
  EQ: Object.freeze({
    name: "Equifax Information Services LLC",
    poBox: "P.O. Box 740256, Atlanta, GA 30374-0256",
    hq: "1550 Peachtree Street NE, Atlanta, GA 30309"
  }),
  EX: Object.freeze({
    name: "Experian",
    poBox: "P.O. Box 4500, Allen, TX 75013",
    hq: "475 Anton Blvd, Costa Mesa, CA 92626"
  }),
  TU: Object.freeze({
    name: "TransUnion Consumer Solutions",
    poBox: "P.O. Box 2000, Chester, PA 19016",
    hq: "555 W Adams St, Chicago, IL 60661"
  })
});

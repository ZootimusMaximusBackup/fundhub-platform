/**
 * Which banks need a logo, and which website each one's logo comes from.
 *
 * Full legal names, per the owner rule set 2026-09-05: "American Express", not
 * "Amex". "Wells Fargo", not "Wells".
 *
 * Two lists:
 *   MISSING  — banks in the book with no logo file at all.
 *   WRONG    — banks that HAVE a logo file, but the picture in it is not theirs.
 *              The old run saved a website-builder's default icon, a programming
 *              tool's logo, and one bank's mark copied onto four other banks.
 *
 * A domain here is a starting guess, not a fact. Every one is checked against
 * the words on the page before we keep the picture. A bank whose page does not
 * say its own name is reported, not saved.
 */

/** Banks in the book with no logo file. */
export const MISSING = [
  { slug: "associated-bank", name: "Associated Bank", domain: "associatedbank.com" },
  { slug: "bank-of-blue-valley", name: "Bank of Blue Valley", domain: "bankbv.com" },
  { slug: "bank-of-blue-valley-0", name: "Bank of Blue Valley", domain: "bankbv.com" },
  { slug: "bank-of-utah", name: "Bank of Utah", domain: "bankofutah.com" },
  { slug: "citywide-banks-0", name: "Citywide Banks", domain: "citywidebanks.com" },
  { slug: "columbia-state-bank", name: "Columbia State Bank", domain: "columbiabank.com" },
  { slug: "community-trust-bank", name: "Community Trust Bank", domain: "ctbi.com" },
  { slug: "cornerstone-bank", name: "Cornerstone Bank", domain: "cornerstonebank.com" },
  { slug: "db-and-t", name: "Dubuque Bank and Trust", domain: "dubuquebank.com" },
  { slug: "desert-financial-cu", name: "Desert Financial Credit Union", domain: "desertfinancial.com" },
  { slug: "east-boston-savings-bank", name: "East Boston Savings Bank", domain: "ebsb.com" },
  { slug: "evergreen-bank", name: "Evergreen Bank Group", domain: "evergreenbankgroup.com" },
  { slug: "evergreen-bank-0", name: "Evergreen Bank Group", domain: "evergreenbankgroup.com" },
  { slug: "evertrust-bank", name: "EverTrust Bank", domain: "evertrustbank.com" },
  { slug: "first-bank-alaska", name: "First National Bank Alaska", domain: "fnbalaska.com" },
  { slug: "first-midwest-bank", name: "First Midwest Bank", domain: "firstmidwest.com" },
  { slug: "first-national-bank-texas", name: "First National Bank Texas", domain: "1stnb.com" },
  { slug: "hilltop-bank", name: "Hilltop Bank", domain: "hilltop.bank" },
  { slug: "illinois-bank-and-trust", name: "Illinois Bank and Trust", domain: "illinoisbank.com" },
  { slug: "local-first-bank", name: "Local First Bank", domain: "localfirstbank.com" },
  { slug: "minnesota-bank-and-trust", name: "Minnesota Bank and Trust", domain: "mnbankandtrust.com" },
  { slug: "new-field-national-bank-0", name: "New Field National Bank", domain: "newfieldnationalbank.bank" },
  { slug: "northwest-savings-bank", name: "Northwest Bank", domain: "northwest.bank" },
  { slug: "rocky-mountain-bank-0", name: "Rocky Mountain Bank", domain: "rmbank.com" },
  { slug: "sabine-state-bank", name: "Sabine State Bank", domain: "sabinebank.com" },
  { slug: "synovus-bank", name: "Synovus Bank", domain: "synovus.com" },
  { slug: "tcf-bank", name: "TCF Bank", domain: "tcfbank.com" },
  { slug: "the-farmers-bank", name: "The Farmers Bank", domain: "thefarmersbank.com" },
  { slug: "the-first-bank", name: "The First Bank", domain: "fbtonline.com" },
  { slug: "trustmark-national-bank", name: "Trustmark National Bank", domain: "trustmark.com" },
  { slug: "valley-national-bank", name: "Valley National Bank", domain: "valley.com" },
  { slug: "washington-state-bank", name: "Washington State Bank", domain: "washingtonstatebank.com" },
  { slug: "wisconsin-bank-and-trust", name: "Wisconsin Bank and Trust", domain: "wisconsinbankandtrust.com" }
];

/**
 * Not a bank. "Local Bank Options" is a note in the source spreadsheet telling
 * the advisor to look for a bank near the client. It has no logo because it is
 * not a company. Left here so nobody adds it back as a missing bank.
 */
export const NOT_A_BANK = ["local-bank-options"];

/**
 * Chris has to say which bank this is before it can get a logo.
 *
 * The book has two rows called just "First Bank" — one for Kansas, one for
 * Tennessee and Wyoming — and both send the application to PNC Bank's website.
 * So the picture sitting on that row today is PNC's orange mark. There is also
 * a real, separate "Local First Bank" in North Carolina, which is a different
 * company.
 *
 * We do not know which bank the two rows mean, so we changed nothing. The row
 * keeps the PNC picture it already had. Guessing here would put one bank's logo
 * on another bank's row, and that is the one mistake worth avoiding most.
 */
export const NEEDS_A_DECISION = [
  {
    slug: "clear-mountain-bank",
    name: "Clear Mountain Bank",
    question:
      'Clear Mountain Bank\'s own website shows the logo of its mortgage arm, "HelloHome Mortgage", rather than a bank mark we can pick out automatically. Left blank on purpose. Chris can hand over the right picture if he wants one there.'
  },
  {
    slug: "first-bank",
    name: "First Bank",
    question:
      'Two rows named "First Bank" (Kansas, and Tennessee/Wyoming) both apply through PNC Bank. Which bank are they? Once named, its logo can be fetched.'
  }
];

/** Banks whose existing logo file holds the wrong picture. */
export const WRONG = [
  // These eleven all held the same generic blue grid — a website builder's
  // default icon, not any bank's mark.
  { slug: "berkshire-bank", name: "Berkshire Bank", domain: "berkshirebank.com" },
  { slug: "central-pacific-bank", name: "Central Pacific Bank", domain: "cpb.bank" },
  { slug: "community-bank", name: "Community Bank", domain: "cbna.com" },
  { slug: "exchange-state-bank", name: "Exchange State Bank", domain: "exchangestatebank.com" },
  { slug: "first-american-bank", name: "First American Bank", domain: "firstambank.com" },
  { slug: "first-kentucky-bank", name: "First Kentucky Bank", domain: "firstkybank.com" },
  { slug: "greater-nevada-credit-union", name: "Greater Nevada Credit Union", domain: "gncu.org" },
  { slug: "idaho-first-bank", name: "Idaho First Bank", domain: "idahofirstbank.com" },
  { slug: "intrust-bank", name: "INTRUST Bank", domain: "intrustbank.com" },
  { slug: "premier-bank", name: "Premier Bank", domain: "yourpremierbank.com" },
  { slug: "towne-bank", name: "TowneBank", domain: "townebank.com" },

  // These five all held the AngularJS logo — a programming tool, not a bank.
  { slug: "native-american-bank", name: "Native American Bank", domain: "nativeamericanbank.com" },
  { slug: "native-american-bank-0", name: "Native American Bank", domain: "nativeamericanbank.com" },
  { slug: "providence-bank", name: "Providence Bank", domain: "providencebank.com" },
  { slug: "shore-united-bank-0", name: "Shore United Bank", domain: "shoreunitedbank.com" },
  { slug: "west-bank", name: "West Bank", domain: "westbankstrong.com" },

  // These five all held one navy chevron — the mark of a single valley bank,
  // copied onto four others that have nothing to do with it.
  { slug: "cashmere-valley-bank", name: "Cashmere Valley Bank", domain: "cashmerevalleybank.com" },
  { slug: "north-valley-bank", name: "North Valley Bank", domain: "northvalleybank.com" },
  { slug: "platte-valley-bank", name: "Platte Valley Bank", domain: "plattevalleybank.com" },
  { slug: "premier-valley-bank", name: "Premier Valley Bank", domain: "premiervalleybank.com" },
  { slug: "valley-bank", name: "Valley Bank", domain: "valleybank.net" },

  // Sixteen-pixel blobs, too small and too blurred to read as anything.
  { slug: "commerce-bank", name: "Commerce Bank", domain: "commercebank.com" },
  { slug: "the-bank-of-commerce", name: "The Bank of Commerce", domain: "bankofcommerce.com" },
  { slug: "bank-of-colorado", name: "Bank of Colorado", domain: "bankofcolorado.com" },
  { slug: "pinnacle-bank", name: "Pinnacle Bank", domain: "pinnbank.com" },
  { slug: "arizona-bank-and-trust", name: "Arizona Bank and Trust", domain: "arizonabank.com" },
  { slug: "new-mexico-bank-and-trust", name: "New Mexico Bank and Trust", domain: "nmb-t.com" }
];

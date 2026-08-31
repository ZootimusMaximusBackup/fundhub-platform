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


// ═══════════════════════════════════════════════════════════════════════════════
// STATE ATTORNEY GENERAL CONSUMER-COMPLAINT MAILING ADDRESSES
//
// COMPLIANCE REVIEW REQUIRED — dispute logic.
//
// WHAT THESE ARE FOR. Round 5 of the dispute ladder mails a consumer complaint
// that the client has signed UNDER PENALTY OF PERJURY. A wrong address means
// that sworn complaint is mailed into a void while the client believes it was
// filed. So the standard here is not "an address that probably works" — it is
// the address the office itself publishes for mailing a consumer complaint.
//
// WHERE THEY CAME FROM. Every entry below was read off the state's own site or
// the state's own printable complaint form, then independently re-checked by a
// second reader. The source URL is in the comment above each entry so the next
// person can re-verify one state without redoing the batch. Nothing was taken
// from a third-party directory, and NOTHING WAS INFERRED FROM A PATTERN.
//
// WHAT IS DELIBERATELY MISSING. Twelve states are NOT here — see
// `AG_MAIL_UNRESOLVED` below, which records each one and why. For those states
// `agPostalAddress` returns null, `complaintDestination` in
// ../rounds/complaint-filing.mjs refuses the send with
// `ag_postal_address_unknown`, no filing row is written, and Round 6 stays
// silent about a state attorney general filing — exactly as it did before this
// data existed. THAT REFUSAL IS THE CORRECT BEHAVIOUR AND MUST NOT BE
// "FIXED" WITH A NEAREST-OFFICE OR GENERAL-ADMINISTRATIVE ADDRESS.
//
// FOUR OF THE TWELVE (NV, NY, OK, OR) DO HAVE A PUBLISHED OFFICE ADDRESS. It is
// left out on purpose: in each case the state publishes no postal route for a
// consumer complaint at all, and the only address on the site is the general
// office. Mailing a sworn complaint to a general office address is the exact
// failure this file exists to prevent.
//
// THE ENVELOPE RULE. `address_line1` is printed first, `address_line2` second,
// then the city line — see `contactPayload` in
// ../../messaging/providers/mail-letter.mjs. The Postal Service delivers to the
// address on the LAST line before the city. So where a state publishes both a
// street and a PO Box, or a building name and a street, the line that must
// actually receive the mail goes in `address_line2` and the other in
// `address_line1`. Where a suite or floor belongs to the street it is folded
// into one line. `address_line2` is null when the state publishes one line.
//
// SHAPE. Identical to `CFPB_MAIL_ADDRESS` below, so the send path treats a state
// attorney general exactly as it already treats the CFPB. No new config format,
// no new table.
//
// KEEPING IT HONEST. `ag-statutes.test.mjs` fails if any entry is half filled —
// a missing street, city, two-letter state or ZIP-shaped ZIP — if an entry is
// filed under a state code that disagrees with its own `address_state`, if an
// entry loses its source comment, or if a state in `AG_MAIL_UNRESOLVED` quietly
// gains an address without the list being updated in the same change.
// ═══════════════════════════════════════════════════════════════════════════════

export const AG_MAIL_BY_STATE = Object.freeze({
  // Alabama — Read off the header of the state's own Consumer Complaint Form PDF, which prints
  // both the street (501 Washington Avenue) and the PO Box (300152) with ZIP 36130-0152. The
  // web complaint page gives no mailing address; the general contact page shows only 501
  // Washington Avenue, Montgomery, AL 36104. The PO Box is the line to mail to, so it is the
  // LAST line before the city — see the envelope rule above.
  // Source: https://www.alabamaag.gov/wp-content/uploads/2025/08/AL-Consumer-Complaint-Form.pdf
  AL: Object.freeze({
    stateName: "Alabama",
    office: "Office of the Attorney General, Consumer Interest Division",
    address: Object.freeze({
      company_name: "Office of the Attorney General, Consumer Interest Division",
      address_line1: "501 Washington Avenue",
      address_line2: "Post Office Box 300152",
      address_city: "Montgomery",
      address_state: "AL",
      address_zip: "36130-0152",
      address_country: "US"
    })
  }),
  // Arkansas — The printable complaint form linked from that page prints the full return block:
  // "Return Forms to: Office of Attorney General Tim Griffin, Attn: Consumer Complaints, 101
  // West Capitol Avenue, Little Rock, AR 72201". No suite number is given. The sitting Attorney
  // General's name is deliberately NOT part of the addressee here — it goes stale.
  // Source: https://arkansasag.gov/consumer-protection/file-a-consumer-complaint/
  AR: Object.freeze({
    stateName: "Arkansas",
    office: "Office of the Attorney General, Consumer Protection Division",
    address: Object.freeze({
      company_name: "Office of the Attorney General, Consumer Protection Division",
      address_line1: "Attn: Consumer Complaints",
      address_line2: "101 West Capitol Avenue",
      address_city: "Little Rock",
      address_state: "AR",
      address_zip: "72201",
      address_country: "US"
    })
  }),
  // Arizona — Page says to "mail or deliver a completed form" to this address. Arizona
  // publishes a second accepted address, the Tucson office: 400 W. Congress, South Building,
  // Suite 315, Tucson, AZ 85701. Not used here; Phoenix is the one the complaint page leads
  // with.
  // Source: https://www.azag.gov/complaints/consumer
  AZ: Object.freeze({
    stateName: "Arizona",
    office: "Office of the Attorney General, Consumer Information and Complaints",
    address: Object.freeze({
      company_name: "Office of the Attorney General, Consumer Information and Complaints",
      address_line1: "2005 N Central Ave",
      address_line2: null,
      address_city: "Phoenix",
      address_state: "AZ",
      address_zip: "85004",
      address_country: "US"
    })
  }),
  // California — Form PIU 2, "Consumer Complaint Against a Business/Corporation", prints "Mail
  // Form to: Public Inquiry Unit, Office of the Attorney General, P.O. Box 944255, Sacramento,
  // CA 94244-2550". Same PO Box on oag.ca.gov/contact. PO Box only; no street address is
  // published for consumer complaints.
  // Source: https://oag.ca.gov/sites/all/files/agweb/pdfs/contact/business_corpform.pdf
  CA: Object.freeze({
    stateName: "California",
    office: "Public Inquiry Unit, Office of the Attorney General, California Department of Justice",
    address: Object.freeze({
      company_name: "Public Inquiry Unit, Office of the Attorney General, California Department of Justice",
      address_line1: "P.O. Box 944255",
      address_line2: null,
      address_city: "Sacramento",
      address_state: "CA",
      address_zip: "94244-2550",
      address_country: "US"
    })
  }),
  // Delaware — Complaint form prints "RETURN THIS FORM TO: Consumer Protection Unit, DEPARTMENT
  // OF JUSTICE, STATE OF DELAWARE, 820 N. FRENCH STREET, 5TH FLOOR, WILMINGTON, DE 19801".
  // Confirmed against attorneygeneral.delaware.gov/contact/, which lists Fraud & Consumer
  // Protection at the Carvel State Office Building, same street. The current web complaint page
  // gives only a phone number and an email.
  // Source: https://attorneygeneral.delaware.gov/wp-content/uploads/sites/50/2017/05/2017_complaint_form_updated_052217.pdf
  DE: Object.freeze({
    stateName: "Delaware",
    office: "Consumer Protection Unit, Delaware Department of Justice",
    address: Object.freeze({
      company_name: "Consumer Protection Unit, Delaware Department of Justice",
      address_line1: "Carvel State Office Building",
      address_line2: "820 N. French Street, 5th Floor",
      address_city: "Wilmington",
      address_state: "DE",
      address_zip: "19801",
      address_country: "US"
    })
  }),
  // Florida — Page: "return the completed form to: Office of the Attorney General, PL-01 The
  // Capitol, Tallahassee, Florida 32399-1050". DOMAIN CAVEAT: Florida's AG site is
  // myfloridalegal.com, a .com, not a .gov — there is no .gov equivalent. It is the state's own
  // site, not an aggregator. The legacy PDF carries the same address but names a former
  // Attorney General.
  // Source: https://www.myfloridalegal.com/consumer-protection/consumer-complaint-form
  FL: Object.freeze({
    stateName: "Florida",
    office: "Office of the Attorney General, Consumer Protection Division",
    address: Object.freeze({
      company_name: "Office of the Attorney General, Consumer Protection Division",
      address_line1: "PL-01 The Capitol",
      address_line2: null,
      address_city: "Tallahassee",
      address_state: "FL",
      address_zip: "32399-1050",
      address_country: "US"
    })
  }),
  // Georgia — Header of the state's own Consumer Complaint Form, with the instruction to
  // "submit this form to the address above". Matches consumer.georgia.gov/resolve-your-
  // dispute/how-do-i-file-complaint, which accepts mail and fax but not email. STALE ADDRESS
  // WARNING: 2 Martin Luther King Jr. Drive, Suite 356 East Tower still circulates on third-
  // party sites and is NOT what the state publishes today.
  // Source: https://consumer.georgia.gov/document/document/consumer-complaint-form-english/download
  GA: Object.freeze({
    stateName: "Georgia",
    office: "Office of the Attorney General, Consumer Protection Division",
    address: Object.freeze({
      company_name: "Office of the Attorney General, Consumer Protection Division",
      address_line1: "40 Capitol Square, SW",
      address_line2: null,
      address_city: "Atlanta",
      address_state: "GA",
      address_zip: "30334",
      address_country: "US"
    })
  }),
  // Hawaii — NOT THE ATTORNEY GENERAL. Hawaii's AG (425 Queen Street, Honolulu, HI 96813) does
  // not take consumer complaints; the DCCA Office of Consumer Protection does. Two official
  // sources word it differently: the OCP complaint form at web2.dcca.hawaii.gov prints "235
  // SOUTH BERETANIA STREET, ROOM 801, HONOLULU, HAWAII 96813-2419" (Room, and ZIP+4). Both are
  // official and both deliver; the five-digit ZIP on the cited page is used here. Neighbor-
  // island offices exist (Hilo: 120 Pauahi St., Ste. 212, Hilo, HI 96720; Maui: 2145 Wells
  // Street, Suite 106, P.O. Box 1049, Wailuku, HI 96793-1049) and are not used.
  // Source: https://cca.hawaii.gov/ocp/
  HI: Object.freeze({
    stateName: "Hawaii",
    office: "Office of Consumer Protection, Department of Commerce and Consumer Affairs",
    address: Object.freeze({
      company_name: "Office of Consumer Protection, Department of Commerce and Consumer Affairs",
      address_line1: "Leiopapa A Kamehameha Building",
      address_line2: "235 South Beretania Street, Suite 801",
      address_city: "Honolulu",
      address_state: "HI",
      address_zip: "96813",
      address_country: "US"
    })
  }),
  // Iowa — Address appears twice on the official "File a Consumer Complaint" page. The
  // printable form prints a shorter version of the same address ("1305 East Walnut, Des Moines,
  // Iowa 50319"). Same place.
  // Source: https://www.iowaattorneygeneral.gov/for-consumers/file-a-consumer-complaint
  IA: Object.freeze({
    stateName: "Iowa",
    office: "Consumer Protection Division, Office of the Attorney General of Iowa",
    address: Object.freeze({
      company_name: "Consumer Protection Division, Office of the Attorney General of Iowa",
      address_line1: "Hoover State Office Building",
      address_line2: "1305 E. Walnut Street",
      address_city: "Des Moines",
      address_state: "IA",
      address_zip: "50319-0106",
      address_country: "US"
    })
  }),
  // Idaho — Header of the official Consumer Complaint Form: "Please print completed form and
  // mail it to the address listed above." Confirmed again on ag.idaho.gov/consumer-
  // protection/consumer-complaints/. ZIP 83720-0010 belongs to the PO Box, so the PO Box is the
  // last line before the city. The division's WALK-IN office is temporarily Bldg 8 - First
  // Floor, 11331 W. Chinden Blvd., Boise, ID 83714 — a visit address, not a mail address.
  // Source: https://www.ag.idaho.gov/content/uploads/2025/09/CPDComplaintForm.pdf
  ID: Object.freeze({
    stateName: "Idaho",
    office: "Consumer Protection Division, Office of the Attorney General",
    address: Object.freeze({
      company_name: "Consumer Protection Division, Office of the Attorney General",
      address_line1: "954 W. Jefferson, 2nd Floor",
      address_line2: "P.O. Box 83720",
      address_city: "Boise",
      address_state: "ID",
      address_zip: "83720-0010",
      address_country: "US"
    })
  }),
  // Illinois — Top of the official Consumer Fraud Complaint form: "Fill out the form online,
  // then print and mail to the address above." The Consumer Protection landing page lists
  // Springfield, Chicago and Carbondale offices but names no mailing address for complaints.
  // Source: https://illinoisattorneygeneral.gov/Page-Attachments/ConsumerComplaint_English.pdf
  IL: Object.freeze({
    stateName: "Illinois",
    office: "Consumer Fraud Bureau, Office of the Illinois Attorney General",
    address: Object.freeze({
      company_name: "Consumer Fraud Bureau, Office of the Illinois Attorney General",
      address_line1: "500 South Second Street",
      address_line2: null,
      address_city: "Springfield",
      address_state: "IL",
      address_zip: "62701",
      address_country: "US"
    })
  }),
  // Indiana — Printed on the official complaint form under "Section 8 - Mail Completed Forms
  // to:". The Consumer Protection Division web page lists no mailing address and only offers
  // online filing.
  // Source: https://www.in.gov/attorneygeneral/consumer-protection-division/files/Fillable-Consumer-Complaint-Form_UPDATE.pdf
  IN: Object.freeze({
    stateName: "Indiana",
    office: "Consumer Protection Division, Office of the Indiana Attorney General",
    address: Object.freeze({
      company_name: "Consumer Protection Division, Office of the Indiana Attorney General",
      address_line1: "Government Center South, 5th Floor",
      address_line2: "302 W. Washington Street",
      address_city: "Indianapolis",
      address_state: "IN",
      address_zip: "46204",
      address_country: "US"
    })
  }),
  // Kentucky — Printed as "RETURN TO:" on the current official Consumer Mediation Request Form.
  // The unit that handles general consumer mediation is the Office of Senior Protection and
  // Mediation, so that is the addressee even though other pages call it the Office of Consumer
  // Protection. No suite number on the current form; older material shows "Suite 200". Written
  // as printed.
  // Source: https://www.ag.ky.gov/Resources/Consumer-Resources/Consumers/Documents/complaint_gen.pdf
  KY: Object.freeze({
    stateName: "Kentucky",
    office: "Office of Senior Protection and Mediation, Office of the Attorney General",
    address: Object.freeze({
      company_name: "Office of Senior Protection and Mediation, Office of the Attorney General",
      address_line1: "1024 Capital Center Drive",
      address_line2: null,
      address_city: "Frankfort",
      address_state: "KY",
      address_zip: "40601",
      address_country: "US"
    })
  }),
  // Louisiana — PO Box only — this is what the state publishes for mailing a consumer dispute
  // form. No street address is given for complaints.
  // Source: https://ag.louisiana.gov/Page/ConsumerDispute
  LA: Object.freeze({
    stateName: "Louisiana",
    office: "Consumer Protection Section, Office of the Attorney General",
    address: Object.freeze({
      company_name: "Consumer Protection Section, Office of the Attorney General",
      address_line1: "P.O. Box 94005",
      address_line2: null,
      address_city: "Baton Rouge",
      address_state: "LA",
      address_zip: "70804-9005",
      address_country: "US"
    })
  }),
  // Massachusetts — "By mail" section of the AG's own How-To page: "You can print our complaint
  // form, fill it out, and mail it to: Office of the Attorney General, Consumer Advocacy &
  // Response Division, One Ashburton Place, 18th Floor, Boston, MA 02108." mass.gov blocked
  // plain fetching; read in a browser.
  // Source: https://www.mass.gov/how-to/file-a-consumer-complaint
  MA: Object.freeze({
    stateName: "Massachusetts",
    office: "Office of the Attorney General, Consumer Advocacy & Response Division",
    address: Object.freeze({
      company_name: "Office of the Attorney General, Consumer Advocacy & Response Division",
      address_line1: "One Ashburton Place, 18th Floor",
      address_line2: null,
      address_city: "Boston",
      address_state: "MA",
      address_zip: "02108",
      address_country: "US"
    })
  }),
  // Maryland — Printed on the official complaint form under "PLEASE MAIL YOUR COMPLAINT TO THE
  // OFFICE LISTED BELOW THAT IS NEAREST YOU." Baltimore is the main office and is the one used
  // here. The same form lists three regional alternatives (Salisbury, Hagerstown, Largo) which
  // are NOT used, because "nearest you" cannot be resolved from a state code alone.
  // Source: https://oag.maryland.gov/i-need-to/Documents/pdfs/gen.pdf
  MD: Object.freeze({
    stateName: "Maryland",
    office: "Consumer Protection Division, Office of the Attorney General",
    address: Object.freeze({
      company_name: "Consumer Protection Division, Office of the Attorney General",
      address_line1: "200 Saint Paul Place",
      address_line2: null,
      address_city: "Baltimore",
      address_state: "MD",
      address_zip: "21202",
      address_country: "US"
    })
  }),
  // Michigan — Official printable Consumer Complaint Form, section "3. Filing Instructions":
  // "You may send your documents here: Consumer Protection Division, P.O. Box 30213, Lansing,
  // MI 48909-7713." Linked from michigan.gov/ag/complaints. The 525 W. Ottawa St. address in
  // the site footer is the department's general office, not the complaint address.
  // Source: https://www.michigan.gov/-/media/Project/Websites/AG/complaints/Consumer_Complaint_Form__paper.pdf
  MI: Object.freeze({
    stateName: "Michigan",
    office: "Consumer Protection Division",
    address: Object.freeze({
      company_name: "Consumer Protection Division",
      address_line1: "P.O. Box 30213",
      address_line2: null,
      address_city: "Lansing",
      address_state: "MI",
      address_zip: "48909-7713",
      address_country: "US"
    })
  }),
  // Minnesota — Under "Written Correspondence" on the AG's Contact page. Same address on the
  // Consumer Assistance Request Form page and in the site footer. TWO CAVEATS: the domain is
  // ag.state.mn.us — a state government domain but NOT a .gov — and Minnesota steers consumers
  // to its online Consumer Assistance Request Form, saying it is limiting incoming mail. The
  // addressee names the sitting Attorney General because that is how the state prints it; re-
  // check it when Minnesota's Attorney General changes.
  // Source: https://www.ag.state.mn.us/office/contactus.asp
  MN: Object.freeze({
    stateName: "Minnesota",
    office: "Office of Minnesota Attorney General Keith Ellison",
    address: Object.freeze({
      company_name: "Office of Minnesota Attorney General Keith Ellison",
      address_line1: "445 Minnesota Street, Suite 600",
      address_line2: null,
      address_city: "St. Paul",
      address_state: "MN",
      address_zip: "55101",
      address_country: "US"
    })
  }),
  // Missouri — Official Consumer Complaint Form: "please complete and mail this form to:
  // Missouri Attorney General's Office - Consumer Protection Unit - P.O. Box 899 - Jefferson
  // City, MO 65102." Linked from ago.mo.gov/file-a-complaint/consumer-complaint/, which itself
  // lists no address.
  // Source: https://ago.mo.gov/wp-content/uploads/consumercomplaintformCH.pdf
  MO: Object.freeze({
    stateName: "Missouri",
    office: "Missouri Attorney General's Office, Consumer Protection Unit",
    address: Object.freeze({
      company_name: "Missouri Attorney General's Office, Consumer Protection Unit",
      address_line1: "P.O. Box 899",
      address_line2: null,
      address_city: "Jefferson City",
      address_state: "MO",
      address_zip: "65102",
      address_country: "US"
    })
  }),
  // Montana — OCP Contact Information block: "You may contact the Office of Consumer Protection
  // by phone, fax, U.S. Mail and e-mail. Office of Consumer Protection, P. O. Box 200151,
  // Helena, MT 59620-0151." A separate physical address is given for walk-ins only (Mazurek
  // Building, 215 North Sanders). dojmt.gov blocked plain fetching; read in a browser.
  // Source: https://dojmt.gov/office-of-consumer-protection/
  MT: Object.freeze({
    stateName: "Montana",
    office: "Office of Consumer Protection",
    address: Object.freeze({
      company_name: "Office of Consumer Protection",
      address_line1: "P.O. Box 200151",
      address_line2: null,
      address_city: "Helena",
      address_state: "MT",
      address_zip: "59620-0151",
      address_country: "US"
    })
  }),
  // North Carolina — Confirmed twice on state-owned pages: the NCDOJ contact page lists this
  // under "Consumer Protection / File a Complaint", and NCDOJ's downloadable complaint form
  // prints "MAIL TO: CONSUMER PROTECTION, ATTORNEY GENERAL'S OFFICE, 9001 MAIL SERVICE CENTER,
  // RALEIGH, NC 27699-9001". 114 West Edenton Street is the physical campus, not the complaint
  // mail address.
  // Source: https://ncdoj.gov/contact-doj/
  NC: Object.freeze({
    stateName: "North Carolina",
    office: "Consumer Protection, North Carolina Attorney General's Office",
    address: Object.freeze({
      company_name: "Consumer Protection, North Carolina Attorney General's Office",
      address_line1: "9001 Mail Service Center",
      address_line2: null,
      address_city: "Raleigh",
      address_state: "NC",
      address_zip: "27699-9001",
      address_country: "US"
    })
  }),
  // North Dakota — Read directly off the state's official consumer complaint form (SFN 7418,
  // rev. 02-2022): "SEND TO: CONSUMER PROTECTION DIVISION, OFFICE OF ATTORNEY GENERAL, 1720
  // BURLINGTON DRIVE STE C, BISMARCK ND 58504-7736".
  // Source: https://attorneygeneral.nd.gov/wp-content/uploads/2023/01/ConsumerComplaint-SFN7418.pdf
  ND: Object.freeze({
    stateName: "North Dakota",
    office: "Consumer Protection Division, Office of Attorney General",
    address: Object.freeze({
      company_name: "Consumer Protection Division, Office of Attorney General",
      address_line1: "1720 Burlington Drive, Ste C",
      address_line2: null,
      address_city: "Bismarck",
      address_state: "ND",
      address_zip: "58504-7736",
      address_country: "US"
    })
  }),
  // Nebraska — "Return To:" block on the AG's official Consumer Complaint Form. Nebraska
  // publishes TWO different addresses: this mail-in complaint address (2115 State Capitol, ZIP
  // 68509) and a street/office address on ago.nebraska.gov/consumer-protection (1445 K Street,
  // Room 2115, Lincoln, NE 68508). The State Capitol one is the mail-a-complaint address.
  // Source: https://protectthegoodlife.nebraska.gov/sites/default/files/doc/Consumer%20Complaint%20Form%20Revised%209-30-20.pdf
  NE: Object.freeze({
    stateName: "Nebraska",
    office: "Consumer Affairs Response Team",
    address: Object.freeze({
      company_name: "Consumer Affairs Response Team",
      address_line1: "2115 State Capitol",
      address_line2: null,
      address_city: "Lincoln",
      address_state: "NE",
      address_zip: "68509",
      address_country: "US"
    })
  }),
  // New Hampshire — The state's own mail-in Consumer Complaint Form page ("Download Mail-in
  // Form"), whose Contact Information block gives this address. It is the page linked as
  // "Download the Form Here" from doj.nh.gov/citizens/consumer-protection-antitrust-
  // bureau/consumer-complaints, which itself gives no address. Same street address in the
  // doj.nh.gov footer. NH requires all complaints in writing on its complaint form. doj.nh.gov
  // blocked plain fetching; read in a browser.
  // Source: https://onlineforms.nh.gov/app/#/formversion/78cd90e3-8f39-4860-b2cf-41011f4522a8
  NH: Object.freeze({
    stateName: "New Hampshire",
    office: "Consumer Protection & Antitrust Bureau, Department of Justice",
    address: Object.freeze({
      company_name: "Consumer Protection & Antitrust Bureau, Department of Justice",
      address_line1: "1 Granite Place South",
      address_line2: null,
      address_city: "Concord",
      address_state: "NH",
      address_zip: "03301",
      address_country: "US"
    })
  }),
  // New Jersey — Letterhead of the official printable complaint form. The form prints no
  // separate "mail to" line; the letterhead address is the return address. Linked from
  // njconsumeraffairs.gov/pages/printable-forms.aspx. The Complaints landing page renders only
  // via JavaScript and shows no address in raw HTML.
  // Source: https://www.njconsumeraffairs.gov/ComplaintsForms/NJ-Office-of-Consumer-Protection-Complaint-Form.pdf
  NJ: Object.freeze({
    stateName: "New Jersey",
    office: "New Jersey Office of the Attorney General, Division of Consumer Affairs",
    address: Object.freeze({
      company_name: "New Jersey Office of the Attorney General, Division of Consumer Affairs",
      address_line1: "P.O. Box 45025",
      address_line2: null,
      address_city: "Newark",
      address_state: "NJ",
      address_zip: "07101",
      address_country: "US"
    })
  }),
  // New Mexico — The AG office is now branded the New Mexico Department of Justice; nmag.gov
  // redirects to nmdoj.gov. Its complaint page offers a printable Complaint/Information Form
  // and says to return it "to us at one of our primary locations." Santa Fe is the
  // headquarters. The other two primary locations (201 3rd St. NW, Suite 300, Albuquerque, NM
  // 87102; 1175 Commerce Dr, Suite A, Las Cruces, NM 88011) are not used. No separate consumer-
  // protection mailing address is published.
  // Source: https://nmdoj.gov/contact-us/
  NM: Object.freeze({
    stateName: "New Mexico",
    office: "New Mexico Department of Justice (Office of the Attorney General)",
    address: Object.freeze({
      company_name: "New Mexico Department of Justice (Office of the Attorney General)",
      address_line1: "Villagra Building",
      address_line2: "408 Galisteo Street",
      address_city: "Santa Fe",
      address_state: "NM",
      address_zip: "87501",
      address_country: "US"
    })
  }),
  // Ohio — Official Consumer Complaint Form, linked from ohioattorneygeneral.gov/Individuals-
  // and-Families/Consumers/File-a-Complaint: "By mail: Complete this form in dark ink and mail
  // to: Consumer Protection Section, 30 E. Broad St., 14th floor, Columbus, OH 43215-3400". The
  // form's letterhead shows the same street without the +4.
  // Source: https://www.ohioattorneygeneral.gov/Files/Forms/Forms-for-Consumers/ConsumerComplaintForm.aspx
  OH: Object.freeze({
    stateName: "Ohio",
    office: "Consumer Protection Section, Ohio Attorney General's Office",
    address: Object.freeze({
      company_name: "Consumer Protection Section, Ohio Attorney General's Office",
      address_line1: "30 E. Broad St., 14th Floor",
      address_line2: null,
      address_city: "Columbus",
      address_state: "OH",
      address_zip: "43215-3400",
      address_country: "US"
    })
  }),
  // Pennsylvania — Official consumer complaint page: "All documents related to consumer
  // complaints should be sent to the following address: Office of Attorney General, Bureau of
  // Consumer Protection, 15th Floor, Strawberry Square, Harrisburg, PA 17120."
  // Source: https://www.attorneygeneral.gov/submit-a-complaint/consumer-complaint/
  PA: Object.freeze({
    stateName: "Pennsylvania",
    office: "Office of Attorney General, Bureau of Consumer Protection",
    address: Object.freeze({
      company_name: "Office of Attorney General, Bureau of Consumer Protection",
      address_line1: "15th Floor, Strawberry Square",
      address_line2: null,
      address_city: "Harrisburg",
      address_state: "PA",
      address_zip: "17120",
      address_country: "US"
    })
  }),
  // South Dakota — Read off the state's own printable consumer complaint form. WARNING: the
  // state's contact page at consumer.sd.gov/contact.aspx prints a different, garbled street
  // line ("1302 E Hwy 1889 Ste 3"). The complaint form is the version to trust; do not use the
  // contact-page wording.
  // Source: https://consumer.sd.gov/docs/Consumer%20Complaint%20Form.pdf
  SD: Object.freeze({
    stateName: "South Dakota",
    office: "Office of Attorney General, Division of Consumer Protection",
    address: Object.freeze({
      company_name: "Office of Attorney General, Division of Consumer Protection",
      address_line1: "1302 E Hwy 14, Suite 3",
      address_line2: null,
      address_city: "Pierre",
      address_state: "SD",
      address_zip: "57501-8053",
      address_country: "US"
    })
  }),
  // Tennessee — Same address is printed at the top of the official complaint form at
  // tn.gov/content/dam/tn/attorneygeneral/documents/consumer/consumer-complaint-form.pdf. PO
  // Box only; no street address published for consumer complaints.
  // Source: https://www.tn.gov/attorneygeneral/working-for-tennessee/consumer/contact.html
  TN: Object.freeze({
    stateName: "Tennessee",
    office: "Division of Consumer Affairs, Attorney General's Office",
    address: Object.freeze({
      company_name: "Division of Consumer Affairs, Attorney General's Office",
      address_line1: "P.O. Box 20207",
      address_line2: null,
      address_city: "Nashville",
      address_state: "TN",
      address_zip: "37202-0207",
      address_country: "US"
    })
  }),
  // Texas — Printable complaint form: "Please return this form to: Office of the Attorney
  // General, P.O. Box 12548, Austin, Texas 78711-2548". The Consumer Protection Division
  // brochure prints the same box under "CONSUMER PROTECTION DIVISION". Texas pushes consumers
  // to its online portal first; the mail route still exists. PO Box only.
  // Source: https://www2.texasattorneygeneral.gov/files/cpd/complaintform.pdf
  TX: Object.freeze({
    stateName: "Texas",
    office: "Office of the Attorney General, Consumer Protection Division",
    address: Object.freeze({
      company_name: "Office of the Attorney General, Consumer Protection Division",
      address_line1: "P.O. Box 12548",
      address_line2: null,
      address_city: "Austin",
      address_state: "TX",
      address_zip: "78711-2548",
      address_country: "US"
    })
  }),
  // Utah — ROUTING CAVEAT. Confirmed from the Attorney General's own complaint form ("Please
  // Mail To: UTAH ATTORNEY GENERAL'S OFFICE, UTAH STATE CAPITOL, P.O. Box 142320, Salt Lake
  // City, UT 84114-2320"). BUT in Utah most consumer complaints against businesses are handled
  // by the Division of Consumer Protection in the Department of Commerce, not by the Attorney
  // General, and the AG's contact page lists no consumer-complaint mailing address at all. The
  // DCP mailing address could NOT be confirmed (dcp.utah.gov and commerce.utah.gov both
  // returned HTTP 403 to automated reads) and is therefore left BLANK rather than guessed.
  // Source: https://attorneygeneral.utah.gov/wp-content/uploads/2021/05/AG-Complaint-Form-fillable.pdf
  UT: Object.freeze({
    stateName: "Utah",
    office: "Utah Attorney General's Office, Utah State Capitol",
    address: Object.freeze({
      company_name: "Utah Attorney General's Office, Utah State Capitol",
      address_line1: "P.O. Box 142320",
      address_line2: null,
      address_city: "Salt Lake City",
      address_state: "UT",
      address_zip: "84114-2320",
      address_country: "US"
    })
  }),
  // Virginia — The official consumer complaint form ends with: "Mail to Office of the Attorney
  // General, 202 North Ninth St., Richmond, VA 23219 or fax to (804) 225-4378". Street address,
  // no PO Box.
  // Source: https://www.oag.state.va.us/consumer-protection/files/OAG_Consumer_Complaint_Form_modified_51716.pdf
  VA: Object.freeze({
    stateName: "Virginia",
    office: "Office of the Attorney General, Consumer Protection Section",
    address: Object.freeze({
      company_name: "Office of the Attorney General, Consumer Protection Section",
      address_line1: "202 North Ninth Street",
      address_line2: null,
      address_city: "Richmond",
      address_state: "VA",
      address_zip: "23219",
      address_country: "US"
    })
  }),
  // Vermont — Consumer Assistance Program page prints "109 State Street, Montpelier, VT
  // 05609-1001". A second official page (ago.vermont.gov/cap/get-help-consumer-complaint)
  // prints the same street with the short ZIP 05609. Either delivers; 05609-1001 is the CAP-
  // specific one. Vermont leads with an online form and prints no explicit "mail your form
  // here" sentence, but this is the published CAP mailing address.
  // Source: https://ago.vermont.gov/cap
  VT: Object.freeze({
    stateName: "Vermont",
    office: "Consumer Assistance Program, Office of the Attorney General",
    address: Object.freeze({
      company_name: "Consumer Assistance Program, Office of the Attorney General",
      address_line1: "109 State Street",
      address_line2: null,
      address_city: "Montpelier",
      address_state: "VT",
      address_zip: "05609-1001",
      address_country: "US"
    })
  }),
  // Washington — The state page's "By Mail ... Then send to:" block gives "800 5th Ave. Suite
  // 2000, Seattle, WA. 98104-3188". The paper complaint form prints the fuller addressee line
  // "OFFICE OF THE ATTORNEY GENERAL / CONSUMER PROTECTION DIVISION / 800 5TH AVENUE, SUITE
  // 2000" but that PDF is hosted on an Amazon S3 bucket, not a .gov domain, so the .gov page is
  // cited.
  // Source: https://www.atg.wa.gov/file-complaint
  WA: Object.freeze({
    stateName: "Washington",
    office: "Office of the Attorney General, Consumer Protection Division",
    address: Object.freeze({
      company_name: "Office of the Attorney General, Consumer Protection Division",
      address_line1: "800 5th Avenue, Suite 2000",
      address_line2: null,
      address_city: "Seattle",
      address_state: "WA",
      address_zip: "98104-3188",
      address_country: "US"
    })
  }),
  // Wisconsin — NOT THE ATTORNEY GENERAL — read this before addressing an envelope. The
  // Wisconsin Attorney General (Dept. of Justice) does NOT take consumer complaints and
  // publishes NO consumer-complaint mailing address; its consumer pages route fraud and scam
  // complaints to DATCP, the Department of Agriculture, Trade and Consumer Protection. Address
  // the envelope to DATCP Bureau of Consumer Protection or it may not be handled. DOJ's general
  // office mail (17 W. Main St., PO Box 7857, Madison WI 53707-7857) is administrative mail,
  // not a consumer complaint intake.
  // Source: https://datcp.wi.gov/Pages/Programs_Services/FileConsumerComplaint.aspx
  WI: Object.freeze({
    stateName: "Wisconsin",
    office: "DATCP Bureau of Consumer Protection",
    address: Object.freeze({
      company_name: "DATCP Bureau of Consumer Protection",
      address_line1: "PO Box 8911",
      address_line2: null,
      address_city: "Madison",
      address_state: "WI",
      address_zip: "53708-8911",
      address_country: "US"
    })
  }),
  // West Virginia — "Option 1: Mail Your Complaint" says "Mail to: Office of the Attorney
  // General, Consumer Protection Division, PO Box 1789, Charleston, WV 25326-1789". PO Box
  // only.
  // Source: https://ago.wv.gov/consumer-protection/file-complaint-consumer-protection-division
  WV: Object.freeze({
    stateName: "West Virginia",
    office: "Office of the Attorney General, Consumer Protection Division",
    address: Object.freeze({
      company_name: "Office of the Attorney General, Consumer Protection Division",
      address_line1: "PO Box 1789",
      address_line2: null,
      address_city: "Charleston",
      address_state: "WV",
      address_zip: "25326-1789",
      address_country: "US"
    })
  }),
  // Wyoming — Official consumer complaints page gives "Office of the Attorney General, Consumer
  // Protection and Antitrust Unit, 109 State Capitol, Cheyenne, WY 82002" and accepts mailed
  // paper submissions. The page warns that incomplete forms are returned unprocessed. The same
  // office's physical/street location is sometimes published as the Kendrick Building, 2320
  // Capitol Avenue; the complaints page gives 109 State Capitol, so that is what is recorded.
  // Source: https://attorneygeneral.wyo.gov/law-office-division/consumer-protection-and-antitrust-unit/consumer-complaints
  WY: Object.freeze({
    stateName: "Wyoming",
    office: "Office of the Attorney General, Consumer Protection and Antitrust Unit",
    address: Object.freeze({
      company_name: "Office of the Attorney General, Consumer Protection and Antitrust Unit",
      address_line1: "109 State Capitol",
      address_line2: null,
      address_city: "Cheyenne",
      address_state: "WY",
      address_zip: "82002",
      address_country: "US"
    })
  }),
});

/**
 * The states whose consumer-complaint mailing address could NOT be confirmed.
 *
 * COMPLIANCE REVIEW REQUIRED — dispute logic.
 *
 * A BLANK IS SAFE; A PLAUSIBLE WRONG ADDRESS IS NOT. Each entry records what was
 * checked and why nothing was recorded, with the URL in the comment above it, so
 * the next person starts from the finding rather than from scratch. Adding a
 * state here does not change behaviour — an unknown state already refuses — it
 * documents that the absence is a finding and not an oversight.
 */
export const AG_MAIL_UNRESOLVED = Object.freeze({
  // Alaska — No consumer-complaint mailing address is published. The Consumer Protection Unit
  // lists only a phone number and an email and routes to an online form; there is no printable
  // mail-in complaint form. The only address on the site is the Department of Law's general
  // Anchorage office in the page footer (1031 West 4th Avenue, Suite 200, Anchorage, AK
  // 99501-1994), which is NOT published as a complaint mailing address and is therefore NOT
  // recorded as one.
  // Checked: https://law.alaska.gov/department/civil/consumer.html
  AK: Object.freeze({ stateName: "Alaska", why: "Alaska publishes no mailing address for a consumer complaint; the only address on the site is the Department of Law's general office." }),
  // Colorado — No consumer-complaint mailing address is published. Colorado takes consumer
  // complaints only through stopfraudcolorado.gov; there is no printable mail-in form. Two
  // addresses appear on coag.gov but neither is for consumer complaints: 1300 Broadway, 10th
  // Floor is for state-employee waste/fraud/abuse and is the general office; 1300 Broadway, 7th
  // Floor is only for repossessor bonds.
  // Checked: https://coag.gov/file-complaint/
  CO: Object.freeze({ stateName: "Colorado", why: "Colorado takes consumer complaints through an online portal only and publishes no mailing address for one." }),
  // Connecticut — No consumer-complaint mailing address is published. The Attorney General's
  // complaint page offers an online form and a phone line only, with no mail-in option and no
  // printable form. 165 Capitol Avenue, Hartford, CT 06106 is the office location for visits
  // and general inquiries, not a complaint mailing address. Note also that in Connecticut most
  // consumer complaints are handled by the Department of Consumer Protection, a separate
  // agency.
  // Checked: https://portal.ct.gov/ag/common/complaint-form-inquiries/consumer-complaints
  CT: Object.freeze({ stateName: "Connecticut", why: "Connecticut's Attorney General offers an online form and a phone line only, and publishes no mailing address for a consumer complaint." }),
  // Kansas — No consumer-complaint mailing address is published. The Contact Us page lists one
  // address for the whole office; under "Consumer Protection" it gives only a hotline and a
  // link to file online. The "File a Complaint" pages offer no printable consumer complaint
  // form to mail. The office address is real and official, but the state never says to mail a
  // consumer complaint there. Reaching this site needs a real browser; plain fetching is
  // blocked by a bot filter.
  // Checked: https://www.ag.ks.gov/about-the-office/contact-us
  KS: Object.freeze({ stateName: "Kansas", why: "Kansas publishes one address for the whole office and never says to mail a consumer complaint there." }),
  // Maine — No consumer-complaint mailing address is published. Maine's consumer complaint page
  // directs everyone to an online form or a phone line. The only address is the whole office's,
  // from the Contact Us page, where Consumer Protection is listed with no address of its own.
  // Note the ZIP Maine prints there — 04330-0006 — is unusual for a State House Station address
  // (normally 04333) and is printed the same way on both maine.gov and www1.maine.gov, so it is
  // not a transcription slip.
  // Checked: https://www.maine.gov/ag/consumer/complaints/index.shtml
  ME: Object.freeze({ stateName: "Maine", why: "Maine directs every consumer complaint to an online form or a phone line and publishes no mailing address for one." }),
  // Mississippi — UNVERIFIED ON DOMAIN. The AG's printable complaint form — itself a sworn
  // affidavit — prints "Post Office Box 22947, Jackson, Mississippi 39225-2947" in its
  // letterhead. But the state address ago.state.ms.us 301-redirects to
  // attorneygenerallynnfitch.com, a .com the sitting Attorney General runs, so the page
  // actually served is not a state .gov. The online version of the same form does live on a
  // real state domain (portal.ago.ms.gov) but publishes no mailing address. The footer's P.O.
  // Box 220 is the general AG office, not consumer protection.
  // Checked: https://portal.ago.ms.gov/public/?q=node/403
  MS: Object.freeze({ stateName: "Mississippi", why: "The only Mississippi address is on a form served from a .com the sitting Attorney General runs, not from a state .gov." }),
  // Nevada — UNVERIFIED AS A CURRENT ROUTE. The state's printable complaint form carries the
  // letterhead "STATE OF NEVADA, OFFICE OF THE ATTORNEY GENERAL, 100 N. Carson St., Carson
  // City, NV 89701" and says to mail the form to the office listed above. BUT Nevada's current
  // complaint page no longer links that PDF, routes consumers to an online Microsoft Forms
  // submission only, and publishes no mailing address; neither does the Bureau of Consumer
  // Protection page. Mail would probably arrive, but "probably" is not good enough for a
  // document signed under penalty of perjury. Confirm by phone (775-684-1100) before this is
  // filled in.
  // Checked: https://ag.nv.gov/Complaints/CSU_Complaints___FAQ/
  NV: Object.freeze({ stateName: "Nevada", why: "Nevada's current complaint page publishes no mailing address and routes consumers to an online form; the address on the old PDF needs a phone call to confirm." }),
  // New York — UNVERIFIED AS A COMPLAINT ROUTE. New York publishes NO mailing address for
  // consumer complaints. Every consumer complaint form on ag.ny.gov is an online-only web form
  // and the old printable PDF now redirects to the online portal. The only postal address the
  // office publishes anywhere is the general office address (The Capitol, Albany, NY
  // 12224-0341), which the sourcing note explicitly says must not be presented to a consumer as
  // a confirmed filing address. So it is not recorded here.
  // Checked: https://ag.ny.gov/contact-us
  NY: Object.freeze({ stateName: "New York", why: "New York publishes no mailing address for consumer complaints at all; the only postal address on the site is the general office." }),
  // Oklahoma — UNVERIFIED AS A COMPLAINT ROUTE. Oklahoma publishes no mailing address for
  // consumer complaints. The Consumer Protection Unit page takes an embedded online form, or a
  // completed PDF emailed to ConsumerProtection@oag.ok.gov. No postal option is offered. 313 NE
  // 21st Street, Oklahoma City, OK 73105 is the general office address from the Contact page,
  // not a complaint address.
  // Checked: https://oklahoma.gov/oag/about/contact.html
  OK: Object.freeze({ stateName: "Oklahoma", why: "Oklahoma offers an online form or an emailed PDF and publishes no postal route for a consumer complaint." }),
  // Oregon — UNVERIFIED AS A COMPLAINT ROUTE. Oregon's Consumer Protection contact page offers
  // only a hotline, an email and an online complaint form. No consumer-protection mailing
  // address is published. 1162 Court St. NE, Salem, OR 97301-4096 is labelled "Mailing address:
  // Oregon Department of Justice" on the department-wide contact page and is the general
  // department address, not a complaint address.
  // Checked: https://www.doj.state.or.us/consumer-protection/contact-us/
  OR: Object.freeze({ stateName: "Oregon", why: "Oregon publishes a hotline, an email and an online form for consumer complaints, and no consumer-protection mailing address." }),
  // Rhode Island — CONFIRM BEFORE USE — possible stale form. The only address Rhode Island
  // publishes with an explicit mail instruction is on a PDF hosted on riag.ri.gov, but that
  // file was authored in January 2019, still uses the pre-2020 state name "Providence
  // Plantations", and is not linked from the current consumer pages, which route complaints to
  // an online-only form. 4 Howard Avenue is still a live RIAG location; the AG's main office is
  // 150 South Main Street, Providence, RI 02903, which is what the current Consumer Protection
  // page shows. Phone 401-274-4400 prompt 1 to confirm which one takes mailed complaints today.
  // Checked: https://riag.ri.gov/about-our-office/contact-us
  RI: Object.freeze({ stateName: "Rhode Island", why: "The only Rhode Island address with a mail instruction is on a 2019 form that the current consumer pages no longer link." }),
  // South Carolina — WRONG AGENCY RISK. The SC Attorney General's own page says the Consumer
  // Protection and Antitrust Division does not handle individual consumer complaints against
  // businesses — the South Carolina Department of Consumer Affairs, a separate agency, does. So
  // the AG's mailing address (P.O. Box 11549, Columbia, SC 29211) is NOT a consumer complaint
  // route and is not recorded. A South Carolina consumer complaint goes to the SC Department of
  // Consumer Affairs (PO Box 5757, 293 Greystone Blvd, Suite 400, Columbia, SC 29250-5757),
  // confirmed on that agency's own complaint form — but that is a different agency than the one
  // this Round 5 letter is addressed to, so filling it in here would mail an attorney-general
  // complaint to a department that is not the attorney general.
  // Checked: https://www.scag.gov/inside-the-office/legal-services-division/consumer-protection-antitrust/
  SC: Object.freeze({ stateName: "South Carolina", why: "South Carolina's Attorney General does not handle individual consumer complaints; a different agency does, so the AG address is not a complaint route." }),
});

/**
 * The postal address of a state attorney general's office, or null.
 *
 * COMPLIANCE REVIEW REQUIRED — dispute logic.
 *
 * Returns a copy in exactly the shape `CFPB_MAIL_ADDRESS` uses, or NULL for any
 * state whose address is not confirmed above — including every code that is not
 * a US state at all. Null is the refusal: `complaintDestination` in
 * ../rounds/complaint-filing.mjs turns it into `ag_postal_address_unknown`, no
 * complaint is mailed, no filing row is written, and Round 6 says nothing about
 * a state attorney general filing.
 *
 * NEVER return a "nearest office", a general administrative address, or a
 * neighbouring state's address. A state with no confirmed address returns null.
 */
export function agPostalAddress(state) {
  const code = String(state || "").trim().toUpperCase();
  const rec = AG_MAIL_BY_STATE[code];
  return rec ? { ...rec.address } : null;
}

/** True when Round 5 can actually put this state's complaint in the mail. */
export function agIsMailable(state) {
  return agPostalAddress(state) !== null;
}

/**
 * Everything the Round 5 complaint needs to know about one state.
 *
 * `office` is THE OFFICE WE ACTUALLY MAIL TO whenever one is confirmed, so the
 * addressee printed inside the complaint can never disagree with the envelope.
 * That matters in Hawaii and Wisconsin, where consumer complaints are handled by
 * a department that is not the attorney general.
 *
 * `known` still means "we have this state's consumer-protection statute", which
 * is a different question from "we can mail this state" — `mailable` answers
 * that one. A state can be mailable with no statute (the letter then says to
 * search for the citation) and known with no address (the letter is generated
 * but the send is refused).
 */
export function agForState(state) {
  const code = String(state || "").trim().toUpperCase();
  const mail = AG_MAIL_BY_STATE[code] || null;
  const mailable = !!mail;
  if (AG_BY_STATE[code]) {
    return {
      ...AG_BY_STATE[code],
      code,
      known: true,
      mailable,
      office: mail ? mail.office : AG_BY_STATE[code].office
    };
  }
  // No statute on file. Never invent one, and never invent an office name
  // either — fall back to the state code exactly as this has always done.
  const name = mail ? mail.stateName : (code || "your state");
  return {
    code: code || null,
    known: false,
    mailable,
    stateName: name,
    statute: `Search "${name} deceptive trade practices act" and insert the statute citation.`,
    cites: [],
    portal: `Search "${name} attorney general consumer complaint"`,
    office: mail ? mail.office : `${name} Attorney General, Consumer Protection`
  };
}

export const CFPB_FILING = Object.freeze({
  portal: "https://www.consumerfinance.gov/complaint",
  phone: "(855) 411-2372",
  hours: "Mon–Fri 8am–8pm ET",
  mail: "Consumer Financial Protection Bureau, P.O. Box 27170, Washington, DC 20038",
  companyResponseDays: 15
});

/**
 * The same CFPB address as `CFPB_FILING.mail`, in the structured shape the mail
 * provider needs (src/messaging/providers/mail-letter.mjs). Not a second
 * address — src/metro2/letters/ag-statutes.test.mjs fails if the two drift.
 *
 * `AG_MAIL_BY_STATE` above is the state attorney general equivalent, in this
 * same shape, for the 38 states whose address is confirmed. The other 12 have no
 * entry and are refused rather than guessed at.
 */
export const CFPB_MAIL_ADDRESS = Object.freeze({
  company_name: "Consumer Financial Protection Bureau",
  address_line1: "P.O. Box 27170",
  address_line2: null,
  address_city: "Washington",
  address_state: "DC",
  address_zip: "20038",
  address_country: "US"
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

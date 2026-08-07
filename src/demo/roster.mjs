export const DEMO_EMAIL_DOMAIN = "demo.fundhub.local";
export const PLATFORM_TAG = "platform_demo";
export function demoClientEmail(n) {
  return `demo.client.${String(n).padStart(2, "0")}@${DEMO_EMAIL_DOMAIN}`;
}
export const DEMO_CLIENTS = [
  { n: 1, first: "Avery", last: "Cobalt", biz: "Cobalt Harbor Logistics", phone: "+1555700101", tier: "FULL_FUNDING", scores: { ex: 742, eq: 738, tu: 751 }, funded: true, amount: 125000, pipeline: "funding_card_stacking", story: "Stacking." },
  { n: 2, first: "Ellis", last: "Quill", biz: "Quillcrest Media", phone: "+1555700102", tier: "FUNDING_PLUS_REPAIR", scores: { ex: 681, eq: 694, tu: 702 }, funded: false, amount: null, pipeline: "sales", story: "Deposit." },
  { n: 3, first: "Rowan", last: "Pike", biz: "Pike & Lantern Co", phone: "+1555700103", tier: "FULL_FUNDING", scores: { ex: 720, eq: 715, tu: 728 }, funded: true, amount: 88000, pipeline: "funding_altfin", story: "Alt-fin." },
  { n: 4, first: "Sage", last: "Meridian", biz: "Meridian Oak Supply", phone: "+1555700104", tier: "REPAIR_ONLY", scores: { ex: 612, eq: 598, tu: 605 }, funded: false, amount: null, pipeline: "optimization", story: "Repair." },
  { n: 5, first: "Quinn", last: "Lumen", biz: "Lumenbridge Studio", phone: "+1555700105", tier: "MANUAL_REVIEW", scores: { ex: 655, eq: 661, tu: 648 }, funded: false, amount: null, pipeline: "sales", story: "Callback." },
  { n: 6, first: "Reese", last: "Hollow", biz: "Hollowreed Ventures", phone: "+1555700106", tier: "FUNDING_PLUS_REPAIR", scores: { ex: 698, eq: 705, tu: 711 }, funded: false, amount: null, pipeline: "inquiry_removal", story: "Inquiries." },
  { n: 7, first: "Morgan", last: "Vale", biz: "Valebright Systems", phone: "+1555700107", tier: "PREMIUM_STACK", scores: { ex: 768, eq: 774, tu: 781 }, funded: true, amount: 210000, pipeline: "funding_card_stacking", story: "Closeout." },
  { n: 8, first: "Casey", last: "Thorn", biz: "Thornfield Goods", phone: "+1555700108", tier: "FULL_FUNDING", scores: { ex: 730, eq: 722, tu: 735 }, funded: false, amount: null, pipeline: "ar_collections", story: "AR." },
  { n: 9, first: "Riley", last: "Ashford", biz: "Ashford Circuit LLC", phone: "+1555700109", tier: "FUNDING_PLUS_REPAIR", scores: { ex: 670, eq: 682, tu: 677 }, funded: false, amount: null, pipeline: "sales", story: "Downsell." },
  { n: 10, first: "Harper", last: "Wren", biz: "Wren & Copper Works", phone: "+1555700110", tier: "REPAIR_ONLY", scores: { ex: 580, eq: 592, tu: 575 }, funded: false, amount: null, pipeline: "inquiry_removal", story: "Removal." },
  { n: 11, first: "Drew", last: "Solace", biz: "Solace Peak Trading", phone: "+1555700111", tier: "FULL_FUNDING", scores: { ex: 715, eq: 708, tu: 721 }, funded: false, amount: null, pipeline: "affiliates_white_label", story: "Affiliate." },
  { n: 12, first: "Finley", last: "Brook", biz: "Brooklane Partners", phone: "+1555700112", tier: "MANUAL_REVIEW", scores: { ex: 640, eq: 635, tu: 652 }, funded: false, amount: null, pipeline: "hiring", story: "Hiring." }
];
/* Sample lenders for Demo Mode. Every name here is invented — none is a real
   institution — and every row is written with is_demo = true, which makes
   publicLender() render it as "DEMO · <name>" on every screen.

   Three rows per lender_table value, 21 in total.

   `bureaus` and `states` are the two fields matchLenders() actually filters on
   (with `active` and `tier`), so they are what make the list shrink for a
   client with open inquiries. The spread is deliberate:

     EX only 4 · EQ only 5 · TU only 5 · EX/EQ 2 · EQ/TU 2 · EX/TU 1 · EX/EQ/TU 2

   A TransUnion-blocked file therefore drops the 10 rows that touch TU and
   keeps 11, still covering both Experian-only and Equifax-only products —
   which is the per-bureau rotation the funding advisor is meant to demo.

   `min_revenue` and `min_tib` are populated because the columns exist, but
   nothing in matchLenders reads them. They are display detail only. */
export const DEMO_LENDERS = [
  // OnlineBizCC
  { key: "DEMO-LENDER-OBCC", table: "OnlineBizCC", name: "Harborwick National Bank", product: "Harborwick Biz Rewards", typical: 25000, bureaus: "EX", states: "All States", tier: 1, min_revenue: 120000, min_tib: 2 },
  { key: "DEMO-LENDER-OBCC-2", table: "OnlineBizCC", name: "Greystone Ridge Bank", product: "Greystone Online Biz Card", typical: 30000, bureaus: "EQ", states: "All States", tier: 2, min_revenue: 150000, min_tib: 2 },
  { key: "DEMO-LENDER-OBCC-3", table: "OnlineBizCC", name: "Alderpoint Financial", product: "Alderpoint Triple-Pull Card", typical: 40000, bureaus: "EX/EQ/TU", states: "All States", tier: 3, min_revenue: 250000, min_tib: 3 },
  // InBranchBizCC
  { key: "DEMO-LENDER-IBCC", table: "InBranchBizCC", name: "Quillcrest Capital", product: "Quillcrest Branch Card", typical: 18000, bureaus: "EQ", states: "All States", tier: 1, min_revenue: 90000, min_tib: 1 },
  { key: "DEMO-LENDER-IBCC-2", table: "InBranchBizCC", name: "Copperline Bank", product: "Copperline Branch Business", typical: 22000, bureaus: "TU", states: "All States", tier: 2, min_revenue: 110000, min_tib: 2 },
  { key: "DEMO-LENDER-IBCC-3", table: "InBranchBizCC", name: "Saltmarsh Credit Union", product: "Saltmarsh Member Biz Card", typical: 16000, bureaus: "EX/EQ", states: "All States", tier: 3, min_revenue: 75000, min_tib: 1 },
  // BizLOC_Stated
  { key: "DEMO-LENDER-BLS", table: "BizLOC_Stated", name: "Pike Lantern Lending", product: "Stated Income LOC", typical: 50000, bureaus: "TU", states: "All States", tier: 1, min_revenue: 200000, min_tib: 2 },
  { key: "DEMO-LENDER-BLS-2", table: "BizLOC_Stated", name: "Fernhollow Bank", product: "Fernhollow Stated LOC", typical: 60000, bureaus: "EX", states: "All States", tier: 2, min_revenue: 240000, min_tib: 3 },
  { key: "DEMO-LENDER-BLS-3", table: "BizLOC_Stated", name: "Windrow Capital", product: "Windrow Flex Stated Line", typical: 45000, bureaus: "EQ/TU", states: "FL, GA, NC, SC, TN", tier: 3, min_revenue: 180000, min_tib: 2 },
  // BizLOC_Documented
  { key: "DEMO-LENDER-BLD", table: "BizLOC_Documented", name: "Meridian Oak Financial", product: "Documented Biz LOC", typical: 75000, bureaus: "EX/EQ", states: "All States", tier: 1, min_revenue: 400000, min_tib: 3 },
  { key: "DEMO-LENDER-BLD-2", table: "BizLOC_Documented", name: "Bexley Court Financial", product: "Bexley Documented Line", typical: 90000, bureaus: "EQ", states: "AZ, CA, NV, OR, WA", tier: 2, min_revenue: 500000, min_tib: 4 },
  { key: "DEMO-LENDER-BLD-3", table: "BizLOC_Documented", name: "Tallow Creek Bank", product: "Tallow Creek Full-Doc LOC", typical: 65000, bureaus: "TU", states: "IL, OH, MI, IN, WI", tier: 3, min_revenue: 350000, min_tib: 3 },
  // PersonalCC
  { key: "DEMO-LENDER-PCC", table: "PersonalCC", name: "Lumenbridge Card Co", product: "Lumenbridge Everyday", typical: 12000, bureaus: "EX", states: "AZ, CA, NV, OR, WA", tier: 1, min_revenue: null, min_tib: null },
  { key: "DEMO-LENDER-PCC-2", table: "PersonalCC", name: "Marlowe Point Lending", product: "Marlowe Point Rewards", typical: 14000, bureaus: "EX/TU", states: "All States", tier: 2, min_revenue: null, min_tib: null },
  { key: "DEMO-LENDER-PCC-3", table: "PersonalCC", name: "Kestrel Bay Financial", product: "Kestrel Bay Cashback", typical: 10000, bureaus: "EQ", states: "NY, NJ, CT, MA, PA", tier: 3, min_revenue: null, min_tib: null },
  // PersonalLoans
  { key: "DEMO-LENDER-PLN", table: "PersonalLoans", name: "Hollowreed Personal Finance", product: "Hollowreed Flex Loan", typical: 20000, bureaus: "EQ", states: "All States", tier: 1, min_revenue: null, min_tib: null },
  { key: "DEMO-LENDER-PLN-2", table: "PersonalLoans", name: "Underhill Credit Co", product: "Underhill Term Loan", typical: 25000, bureaus: "TU", states: "TX, OK, NM, LA, AR", tier: 2, min_revenue: null, min_tib: null },
  { key: "DEMO-LENDER-PLN-3", table: "PersonalLoans", name: "Northgate Willow Bank", product: "Northgate Consolidation Loan", typical: 35000, bureaus: "EX/EQ/TU", states: "IL, OH, MI, IN, WI", tier: 3, min_revenue: null, min_tib: null },
  // PersonalLOC
  { key: "DEMO-LENDER-PLOC", table: "PersonalLOC", name: "Valebright LOC", product: "Valebright Personal Line", typical: 15000, bureaus: "TU", states: "All States", tier: 1, min_revenue: null, min_tib: null },
  { key: "DEMO-LENDER-PLOC-2", table: "PersonalLOC", name: "Sableford Lending", product: "Sableford Personal Line", typical: 17000, bureaus: "EX", states: "FL, GA, NC, SC, TN", tier: 2, min_revenue: null, min_tib: null },
  { key: "DEMO-LENDER-PLOC-3", table: "PersonalLOC", name: "Emberline Financial", product: "Emberline Revolving Line", typical: 13000, bureaus: "EQ/TU", states: "All States", tier: 3, min_revenue: null, min_tib: null }
];
export const DEMO_AFFILIATE = { name: "DEMO Affiliate — Cobalt Referral Desk", tracking_id: "DEMO-AFF-PLATFORM", email: "affiliate.platform@demo.fundhub.local" };
export const DEMO_PARTNER = { name: "DEMO Partner — Quillcrest White Label", brand_name: "Quillcrest Funding Desk", slug: "demo-partner-platform", contact_email: "partner.platform@demo.fundhub.local" };
export const OUTCOMES = ["deposit", "downsell", "callback", "no_show", "not_a_fit"];
export const BELIEFS = ["pain", "doubt", "cost", "desire", "money", "support", "trust"];
export const CALL_STATES = ["not_started","queued","dialing","navigating_ivr","on_hold","talking_to_rep","transferred_to_human","completed","failed","canceled","retry_scheduled"];

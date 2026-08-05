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
export const DEMO_LENDERS = [
  { key: "DEMO-LENDER-OBCC", table: "OnlineBizCC", name: "Harborwick National Bank", product: "Harborwick Biz Rewards", typical: 25000 },
  { key: "DEMO-LENDER-IBCC", table: "InBranchBizCC", name: "Quillcrest Capital", product: "Quillcrest Branch Card", typical: 18000 },
  { key: "DEMO-LENDER-BLS", table: "BizLOC_Stated", name: "Pike Lantern Lending", product: "Stated Income LOC", typical: 50000 },
  { key: "DEMO-LENDER-BLD", table: "BizLOC_Documented", name: "Meridian Oak Financial", product: "Documented Biz LOC", typical: 75000 },
  { key: "DEMO-LENDER-PCC", table: "PersonalCC", name: "Lumenbridge Card Co", product: "Lumenbridge Everyday", typical: 12000 },
  { key: "DEMO-LENDER-PLN", table: "PersonalLoans", name: "Hollowreed Personal Finance", product: "Hollowreed Flex Loan", typical: 20000 },
  { key: "DEMO-LENDER-PLOC", table: "PersonalLOC", name: "Valebright LOC", product: "Valebright Personal Line", typical: 15000 }
];
export const DEMO_AFFILIATE = { name: "DEMO Affiliate — Cobalt Referral Desk", tracking_id: "DEMO-AFF-PLATFORM", email: "affiliate.platform@demo.fundhub.local" };
export const DEMO_PARTNER = { name: "DEMO Partner — Quillcrest White Label", brand_name: "Quillcrest Funding Desk", slug: "demo-partner-platform", contact_email: "partner.platform@demo.fundhub.local" };
export const OUTCOMES = ["deposit", "downsell", "callback", "no_show", "not_a_fit"];
export const BELIEFS = ["pain", "doubt", "cost", "desire", "money", "support", "trust"];
export const CALL_STATES = ["not_started","queued","dialing","navigating_ivr","on_hold","talking_to_rep","transferred_to_human","completed","failed","canceled","retry_scheduled"];

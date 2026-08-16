// Dispute letter catalog — the eight types the escalation pack emits.
// Owner 2026-08-15: full path after Round 3 is CFPB + state AG, from the same
// engine data. Detection stays in src/metro2/checks/. These strings are labels.

export const LETTER_TYPES = Object.freeze({
  R1_METRO2: "r1_metro2",
  R2_FCRA_MOV: "r2_fcra_mov",
  R3_FINAL_NOTICE: "r3_final_notice",
  FURNISHER_VALIDATION: "furnisher_validation",
  CFPB_COMPLAINT: "cfpb_complaint",
  STATE_AG_COMPLAINT: "state_ag_complaint",
  PERSONAL_INFO: "personal_info",
  INQUIRY_REMOVAL: "inquiry_removal"
});

export const LETTER_TYPE_LIST = Object.freeze(Object.values(LETTER_TYPES));

/** File-level Metro 2 rules — personal info letters, not tradeline dispute. */
export const PERSONAL_RULE_IDS = Object.freeze([
  "M2-031", "M2-032", "M2-033", "M2-034"
]);

/** File-level Metro 2 rules — inquiry-removal letters. */
export const INQUIRY_RULE_IDS = Object.freeze([
  "M2-035", "M2-036", "M2-037", "M2-038"
]);

export const PERSONAL_RULES = new Set(PERSONAL_RULE_IDS);
export const INQUIRY_RULES = new Set(INQUIRY_RULE_IDS);

export const LETTER_META = Object.freeze({
  [LETTER_TYPES.R1_METRO2]: Object.freeze({
    title: "Round 1 Metro 2 dispute",
    audience: "bureau",
    round: "R1",
    sendWhen: "First mail after engine findings",
    signatureOnPdf: "sign_by_hand",
    clientSignRequired: false
  }),
  [LETTER_TYPES.R2_FCRA_MOV]: Object.freeze({
    title: "Round 2 FCRA / method of verification",
    audience: "bureau",
    round: "R2",
    sendWhen: "After Round 1: verified, remains, or no answer past 30 days + mail time",
    signatureOnPdf: "sign_by_hand",
    clientSignRequired: false
  }),
  [LETTER_TYPES.R3_FINAL_NOTICE]: Object.freeze({
    title: "Round 3 final notice",
    audience: "bureau",
    round: "R3",
    sendWhen: "After Round 2 still verified / no MOV",
    signatureOnPdf: "sign_by_hand",
    clientSignRequired: false
  }),
  [LETTER_TYPES.FURNISHER_VALIDATION]: Object.freeze({
    title: "Debt validation — direct to furnisher",
    audience: "furnisher",
    round: "FURNISHER",
    sendWhen: "Collection / debt-buyer furnishers; cover sheet if 30-day FDCPA window unknown",
    signatureOnPdf: "sign_by_hand",
    clientSignRequired: false
  }),
  [LETTER_TYPES.CFPB_COMPLAINT]: Object.freeze({
    title: "CFPB complaint",
    audience: "cfpb",
    round: "COMPLAINT",
    sendWhen: "After Round 3 failed, or DIY pack as SEND ONLY IF Round 3 failed",
    signatureOnPdf: "declaration",
    clientSignRequired: true
  }),
  [LETTER_TYPES.STATE_AG_COMPLAINT]: Object.freeze({
    title: "State attorney general complaint",
    audience: "state_ag",
    round: "COMPLAINT",
    sendWhen: "File with or after CFPB; state from client address",
    signatureOnPdf: "declaration",
    clientSignRequired: true
  }),
  [LETTER_TYPES.PERSONAL_INFO]: Object.freeze({
    title: "Personal information cleanup",
    audience: "bureau",
    round: "R1",
    sendWhen: "Engine personal-info findings (not the current street)",
    signatureOnPdf: "sign_by_hand",
    clientSignRequired: false
  }),
  [LETTER_TYPES.INQUIRY_REMOVAL]: Object.freeze({
    title: "Inquiry removal (mail)",
    audience: "bureau",
    round: "R1",
    sendWhen: "Engine inquiry findings. Phone remover is ON HOLD — mail only.",
    signatureOnPdf: "sign_by_hand",
    clientSignRequired: false
  })
});

export function isPersonalRule(ruleId) {
  return PERSONAL_RULES.has(ruleId);
}

export function isInquiryRule(ruleId) {
  return INQUIRY_RULES.has(ruleId);
}

export function isTradelineRule(ruleId) {
  return Boolean(ruleId) && !PERSONAL_RULES.has(ruleId) && !INQUIRY_RULES.has(ruleId);
}

export function requiresDeclarationSignature(type) {
  return LETTER_META[type]?.clientSignRequired === true;
}

export function splitViolations(violations = []) {
  const tradeline = [];
  const personal = [];
  const inquiry = [];
  for (const v of violations) {
    if (!v?.ruleId) continue;
    if (PERSONAL_RULES.has(v.ruleId)) personal.push(v);
    else if (INQUIRY_RULES.has(v.ruleId)) inquiry.push(v);
    else tradeline.push(v);
  }
  return { tradeline, personal, inquiry };
}

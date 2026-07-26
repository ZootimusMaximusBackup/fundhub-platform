-- 005_client_custom_fields.sql
-- Auto-generated from 300 live GHL custom fields (location ORh91GeY4acceSASSnLR).
-- Master Spec §B (252 typed client columns) + Rule 2 (cf_* names) + Rule 7 (org_id).
-- Regenerate: node scripts/gen-custom-field-migration.mjs. Do NOT hand-edit.

CREATE TABLE IF NOT EXISTS client_custom_fields (
  client_id   uuid PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES orgs(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  ai_call_enabled                                  text[],   -- CHECKBOX · AI Call Enabled · contact.ai_call_enabled
  cf_call_required                                 text[],   -- CHECKBOX · cf_call_required · contact.cf_call_required
  cf_bs_ads_state                                  text,   -- SINGLE_OPTIONS · cf_bs_ads_state · contact.cf_bs_ads_state
  cf_contract_id                                   text,   -- TEXT · cf_contract_id · contact.cf_contract_id
  doc_fix_instructions                             text,   -- LARGE_TEXT · doc_fix_instructions · contact.doc_fix_instructions
  multi_dropdown_6jm3                              text[],   -- MULTIPLE_OPTIONS · Multi Dropdown 6jm3 · contact.multi_dropdown_6jm3
  cf_remote_session_status                         text,   -- SINGLE_OPTIONS · cf_remote_session_status · contact.cf_remote_session_status
  crs_inquiries_ex                                 numeric,   -- NUMERICAL · CRS Inquiries EX · contact.crs_inquiries_ex
  crs_status                                       text,   -- SINGLE_OPTIONS · CRS Status · contact.crs_status
  cf_bs_selfie_video_sent                          text,   -- SINGLE_OPTIONS · cf_bs_selfie_video_sent · contact.cf_bs_selfie_video_sent
  cf_crs_pull_scope                                text,   -- SINGLE_OPTIONS · cf_crs_pull_scope · contact.cf_crs_pull_scope
  df_status                                        text,   -- TEXT · df_status · contact.df_status
  denials_count                                    numeric,   -- NUMERICAL · Denials Count · contact.denials_count
  affiliate_tier1_owner                            text,   -- TEXT · Affiliate Tier1 Owner · contact.affiliate_tier1_owner
  crs_fico_score                                   numeric,   -- NUMERICAL · CRS FICO Score · contact.crs_fico_score
  keyword_slot                                     text,   -- TEXT · keyword_slot · contact.keyword_slot
  social_security_number                           text,   -- TEXT · Social Security Number · contact.social_security_number
  cf_remote_session_resource_id                    text,   -- TEXT · cf_remote_session_resource_id · contact.cf_remote_session_resource_id
  cf_credit_pull_consent_status                    text,   -- SINGLE_OPTIONS · cf_credit_pull_consent_status · contact.cf_credit_pull_consent_status
  cf_analysis_method                               text,   -- TEXT · cf_analysis_method · contact.cf_analysis_method
  repair_letter_url_round_2_ex                     text,   -- TEXT · Repair Letter URL — Round 2 — EX · contact.repair_letter_url__round_2__ex
  employee_next_action                             text,   -- SINGLE_OPTIONS · Employee Next Action · contact.employee_next_action
  ai_call_packet_tu                                text,   -- LARGE_TEXT · AI Call Packet TU · contact.ai_call_packet_tu
  repair_letter_url_round_1_tu                     text,   -- TEXT · Repair Letter URL — Round 1 — TU · contact.repair_letter_url__round_1__tu
  analyzer_prequal_amount                          text,   -- MONETORY · Analyzer Prequal Amount · contact.analyzer_prequal_amount
  micro_course_id                                  text,   -- TEXT · micro_course_id · contact.micro_course_id
  cf_last_canonical_event                          text,   -- TEXT · cf_last_canonical_event · contact.cf_last_canonical_event
  funding_letter_url_personal_info_cleanup_tu      text,   -- TEXT · Funding Letter URL — Personal Info Cleanup — TU · contact.funding_letter_url__personal_info_cleanup__tu
  contract_funding_signed                          text[],   -- CHECKBOX · Contract Funding Signed · contact.contract_funding_signed
  analyzer_path_raw                                text,   -- TEXT · Analyzer Path Raw · contact.analyzer_path_raw
  cf_bs_last_video_click_ts                        date,   -- DATE · cf_bs_last_video_click_ts · contact.cf_bs_last_video_click_ts
  funding_money_change                             text,   -- TEXT · funding_money_change · contact.funding_money_change
  ai_handoff_at                                    date,   -- DATE · AI Handoff At · contact.ai_handoff_at
  platform                                         text,   -- TEXT · platform · contact.platform
  what_is_your_current_credit_score                text,   -- SINGLE_OPTIONS · What is your current credit score? · contact.what_is_your_current_credit_score
  cf_offer_family                                  text,   -- TEXT · cf_offer_family · contact.cf_offer_family
  behavior_confidence                              text,   -- TEXT · behavior_confidence · contact.behavior_confidence
  cf_analyzer_cost_of_delay                        text,   -- MONETORY · cf_analyzer_cost_of_delay · contact.cf_analyzer_cost_of_delay
  cf_precall_backend_active                        text[],   -- CHECKBOX · cf_precall_backend_active · contact.cf_precall_backend_active
  ai_call_batch_id                                 text,   -- TEXT · AI Call Batch ID · contact.ai_call_batch_id
  cf_crs_charge_amount                             text,   -- MONETORY · cf_crs_charge_amount · contact.cf_crs_charge_amount
  cf_last_progress_action                          text,   -- SINGLE_OPTIONS · cf_last_progress_action · contact.cf_last_progress_action
  cf_funnel_version                                text,   -- TEXT · cf_funnel_version · contact.cf_funnel_version
  churn_date                                       date,   -- DATE · Churn Date · contact.churn_date
  ai_call_needed_tu                                text[],   -- CHECKBOX · AI Call Needed TU · contact.ai_call_needed_tu
  cf_bs_email_last_sent_ts                         date,   -- DATE · Last Backend Email Sent · contact.cf_bs_email_last_sent_ts
  analyzer_status                                  text,   -- SINGLE_OPTIONS · Analyzer Status · contact.analyzer_status
  cf_analyzer_recommendation                       text,   -- SINGLE_OPTIONS · cf_analyzer_recommendation · contact.cf_analyzer_recommendation
  behavior_responsiveness                          numeric,   -- NUMERICAL · behavior_responsiveness · contact.behavior_responsiveness
  ai_last_call_outcome                             text,   -- TEXT · AI Last Call Outcome · contact.ai_last_call_outcome
  pre_call_question                                text,   -- TEXT · pre_call_question · contact.pre_call_question
  multi_dropdown_4aqq                              text[],   -- MULTIPLE_OPTIONS · Multi Dropdown 4aqq · contact.multi_dropdown_4aqq
  crs_utilization_percent                          numeric,   -- NUMERICAL · CRS Utilization Percent · contact.crs_utilization_percent
  repair_balance_due                               text,   -- MONETORY · Repair Balance Due · contact.repair_balance_due
  multi_dropdown_3xl3                              text[],   -- MULTIPLE_OPTIONS · Multi Dropdown 3xl3 · contact.multi_dropdown_3xl3
  business_name                                    text,   -- TEXT · Business Name · contact.business_name
  cf_analysis_request_id                           text,   -- TEXT · cf_analysis_request_id · contact.cf_analysis_request_id
  primary_snapshot_source                          text,   -- SINGLE_OPTIONS · Primary Snapshot Source · contact.primary_snapshot_source
  affiliate_tier_level                             text,   -- SINGLE_OPTIONS · Affiliate Tier Level · contact.affiliate_tier_level
  primary_utilization_percent                      numeric,   -- NUMERICAL · Primary Utilization Percent · contact.primary_utilization_percent
  cf_setter_user_id                                text,   -- TEXT · cf_setter_user_id · contact.cf_setter_user_id
  multi_dropdown_80fn                              text[],   -- MULTIPLE_OPTIONS · Multi Dropdown 80fn · contact.multi_dropdown_80fn
  crs_snapshot_date                                date,   -- DATE · CRS Snapshot Date · contact.crs_snapshot_date
  ai_transfer_slot_status                          text,   -- SINGLE_OPTIONS · AI Transfer Slot Status · contact.ai_transfer_slot_status
  funding_fee_percent                              numeric,   -- NUMERICAL · Funding Fee Percent · contact.funding_fee_percent
  behavior_engagement                              numeric,   -- NUMERICAL · behavior_engagement · contact.behavior_engagement
  ready_for_next_round                             text[],   -- CHECKBOX · Ready For Next Round · contact.ready_for_next_round
  credit_score                                     numeric,   -- NUMERICAL · credit_score · contact.credit_score
  utm_source                                       text,   -- TEXT · utm_source · contact.utm_source
  cf_business_pull_status                          text,   -- SINGLE_OPTIONS · cf_business_pull_status · contact.cf_business_pull_status
  funding_condition_required                       text[],   -- CHECKBOX · Funding Condition Required · contact.funding_condition_required
  cf_hard_stop_reason                              text,   -- SINGLE_OPTIONS · cf_hard_stop_reason · contact.cf_hard_stop_reason
  cf_graduation_path                               text,   -- SINGLE_OPTIONS · cf_graduation_path · contact.cf_graduation_path
  commission_owed                                  text,   -- MONETORY · Commission Owed · contact.commission_owed
  cf_pod_lookup_status                             text,   -- TEXT · cf_pod_lookup_status · contact.cf_pod_lookup_status
  cf_negative_quote_sent_at                        date,   -- DATE · cf_negative_quote_sent_at · contact.cf_negative_quote_sent_at
  funding_letter_url_personal_info_cleanup_ex      text,   -- TEXT · Funding Letter URL — Personal Info Cleanup — EX · contact.funding_letter_url__personal_info_cleanup__ex
  cf_svy_tried_restoration_before                  text,   -- SINGLE_OPTIONS · cf_svy_tried_restoration_before · contact.cf_svy_tried_restoration_before
  ai_call_lock_state                               text,   -- SINGLE_OPTIONS · AI Call Lock State · contact.ai_call_lock_state
  cf_bs_red_flags_sent                             text,   -- SINGLE_OPTIONS · cf_bs_red_flags_sent · contact.cf_bs_red_flags_sent
  cf_event_contract_version                        text,   -- TEXT · cf_event_contract_version · contact.cf_event_contract_version
  utm_term                                         text,   -- TEXT · utm_term · contact.utm_term
  funding_fico_band                                text,   -- TEXT · funding_fico_band · contact.funding_fico_band
  affiliate_tier2_owner                            text,   -- TEXT · Affiliate Tier2 Owner · contact.affiliate_tier2_owner
  ai_transfer_slot_owner                           text,   -- TEXT · AI Transfer Slot Owner · contact.ai_transfer_slot_owner
  ai_call_lock_until                               date,   -- DATE · AI Call Lock Until · contact.ai_call_lock_until
  multi_dropdown_7kbe                              text[],   -- MULTIPLE_OPTIONS · Multi Dropdown 7kbe · contact.multi_dropdown_7kbe
  product_path                                     text,   -- SINGLE_OPTIONS · Product Path · contact.product_path
  cf_last_canonical_event_ts                       date,   -- DATE · cf_last_canonical_event_ts · contact.cf_last_canonical_event_ts
  repair_letter_url_round_2_eq                     text,   -- TEXT · Repair Letter URL — Round 2 — EQ · contact.repair_letter_url__round_2__eq
  cf_lifetime_value                                text,   -- MONETORY · cf_lifetime_value · contact.cf_lifetime_value
  funding_round_number                             numeric,   -- NUMERICAL · Funding Round Number · contact.funding_round_number
  ai_last_call_at                                  date,   -- DATE · AI Last Call At · contact.ai_last_call_at
  behavior_motivation_label                        text,   -- TEXT · behavior_motivation_label · contact.behavior_motivation_label
  direct_downline_count                            numeric,   -- NUMERICAL · Direct Downline Count · contact.direct_downline_count
  primary_inquiries_tu                             numeric,   -- NUMERICAL · Primary Inquiries TU · contact.primary_inquiries_tu
  cf_svy_your_why                                  text,   -- SINGLE_OPTIONS · cf_svy_your_why · contact.cf_svy_your_why
  cf_decision_timestamp                            date,   -- DATE · cf_decision_timestamp · contact.cf_decision_timestamp
  setter_call_status                               text,   -- SINGLE_OPTIONS · Setter Call Status · contact.setter_call_status
  cf_pod_manager_user_id                           text,   -- TEXT · cf_pod_manager_user_id · contact.cf_pod_manager_user_id
  lifecycle_status                                 text,   -- SINGLE_OPTIONS · Lifecycle Status · contact.lifecycle_status
  primary_motivation                               text,   -- SINGLE_OPTIONS · Primary Motivation · contact.primary_motivation
  first_touch_date                                 date,   -- DATE · First Touch Date · contact.first_touch_date
  repair_deposit_required                          text,   -- MONETORY · Repair Deposit Required · contact.repair_deposit_required
  utilization_pct                                  numeric,   -- NUMERICAL · utilization_pct · contact.utilization_pct
  business_postal_code                             text,   -- TEXT · Business Postal Code · contact.business_postal_code
  business_street_address                          text,   -- TEXT · Business Street Address · contact.business_street_address
  entry_method                                     text,   -- TEXT · entry_method · contact.entry_method
  cf_decision_source                               text,   -- SINGLE_OPTIONS · cf_decision_source · contact.cf_decision_source
  balance_due                                      text,   -- MONETORY · Balance Due · contact.balance_due
  ai_transfer_target_number                        text,   -- PHONE · AI Transfer Target Number · contact.ai_transfer_target_number
  cf_sales_rep_id                                  text,   -- TEXT · cf_sales_rep_id · contact.cf_sales_rep_id
  crs_negative_items_count                         numeric,   -- NUMERICAL · CRS Negative Items Count · contact.crs_negative_items_count
  airtable_client_id                               text,   -- TEXT · Airtable Client ID · contact.airtable_client_id
  business_city                                    text,   -- TEXT · Business City · contact.business_city
  cf_booking_lane                                  text,   -- SINGLE_OPTIONS · cf_booking_lane · contact.cf_booking_lane
  ai_transfer_status                               text,   -- SINGLE_OPTIONS · AI Transfer Status · contact.ai_transfer_status
  agent_context                                    text,   -- LARGE_TEXT · Agent Context · contact.agent_context
  cf_svy_planned_use                               text,   -- SINGLE_OPTIONS · cf_svy_planned_use · contact.cf_svy_planned_use
  repair_letter_url_round_3_eq                     text,   -- TEXT · Repair Letter URL — Round 3 — EQ · contact.repair_letter_url__round_3__eq
  credit_suggestions                               text,   -- LARGE_TEXT · Credit Suggestions · contact.credit_suggestions
  airtable_client_url                              text,   -- TEXT · Airtable Client URL · contact.airtable_client_url
  analyzer_last_run_date                           date,   -- DATE · Analyzer Last Run Date · contact.analyzer_last_run_date
  cf_precall_deposit_credit_amount                 text,   -- MONETORY · cf_precall_deposit_credit_amount · contact.cf_precall_deposit_credit_amount
  affiliate_tracking_id                            text,   -- TEXT · Affiliate Tracking ID · contact.affiliate_tracking_id
  cf_engagement_face_value                         text,   -- MONETORY · cf_engagement_face_value · contact.cf_engagement_face_value
  contactcf_svy_annual_income_range_0u7_copy       text,   -- SINGLE_OPTIONS · cf_svy_annual_income_range (copy) · contact.contactcf_svy_annual_income_range_0u7_copy
  cf_sale_closed_at                                date,   -- DATE · cf_sale_closed_at · contact.cf_sale_closed_at
  employer_identification_number                   text,   -- TEXT · Employer Identification Number · contact.employer_identification_number
  cf_precall_deposit_paid_total                    text,   -- MONETORY · cf_precall_deposit_paid_total · contact.cf_precall_deposit_paid_total
  ai_retry_count_total                             numeric,   -- NUMERICAL · AI Retry Count Total · contact.ai_retry_count_total
  repair_complete_date                             date,   -- DATE · Repair Complete Date · contact.repair_complete_date
  repair_total_price                               text,   -- MONETORY · Repair Total Price · contact.repair_total_price
  referral_id                                      text,   -- TEXT · referral_id · contact.referral_id
  repair_letter_url_round_1_ex                     text,   -- TEXT · Repair Letter URL — Round 1 — EX · contact.repair_letter_url__round_1__ex
  cf_bs_precall_start_ts                           date,   -- DATE · cf_bs_precall_start_ts · contact.cf_bs_precall_start_ts
  cf_unapplied_credit_amount                       text,   -- MONETORY · cf_unapplied_credit_amount · contact.cf_unapplied_credit_amount
  setter_call_disposition                          text,   -- TEXT · Setter Call Disposition · contact.setter_call_disposition
  cf_funding_advisor_user_id                       text,   -- TEXT · cf_funding_advisor_user_id · contact.cf_funding_advisor_user_id
  setter_round_robin_counter                       numeric,   -- NUMERICAL · setter_round_robin_counter · contact.setter_round_robin_counter
  invoice_status                                   text,   -- SINGLE_OPTIONS · Invoice Status · contact.invoice_status
  cf_diy_paid                                      text[],   -- CHECKBOX · cf_diy_paid · contact.cf_diy_paid
  round_hold_reason                                text,   -- SINGLE_OPTIONS · Round Hold Reason · contact.round_hold_reason
  crs_inquiries_eq                                 numeric,   -- NUMERICAL · CRS Inquiries EQ · contact.crs_inquiries_eq
  contract_repair_signed                           text[],   -- CHECKBOX · Contract Repair Signed · contact.contract_repair_signed
  crs_inquiries_tu                                 numeric,   -- NUMERICAL · CRS Inquiries TU · contact.crs_inquiries_tu
  cf_negative_quote_amount                         text,   -- MONETORY · cf_negative_quote_amount · contact.cf_negative_quote_amount
  repair_tried_before                              text,   -- TEXT · repair_tried_before · contact.repair_tried_before
  cf_inquiry_remover_user_id                       text,   -- TEXT · cf_inquiry_remover_user_id · contact.cf_inquiry_remover_user_id
  recon_context                                    text,   -- LARGE_TEXT · recon_context · contact.recon_context
  crs_late_payments_count                          numeric,   -- NUMERICAL · CRS Late Payments Count · contact.crs_late_payments_count
  affiliate_tier2_unlock_date                      date,   -- DATE · Affiliate Tier2 Unlock Date · contact.affiliate_tier2_unlock_date
  business_revenue                                 text,   -- SINGLE_OPTIONS · Business Revenue · contact.business_revenue
  affiliate_activated_date                         date,   -- DATE · Affiliate Activated Date · contact.affiliate_activated_date
  ai_live_bureau                                   text,   -- TEXT · AI Live Bureau · contact.ai_live_bureau
  crs_paid                                         text[],   -- CHECKBOX · CRS Paid · contact.crs_paid
  portal_onboarding_status                         text,   -- SINGLE_OPTIONS · Portal Onboarding Status · contact.portal_onboarding_status
  affiliate_total_leads                            numeric,   -- NUMERICAL · Affiliate Total Leads · contact.affiliate_total_leads
  cf_engagement_remaining_due                      text,   -- MONETORY · cf_engagement_remaining_due · contact.cf_engagement_remaining_due
  behavior_friction                                numeric,   -- NUMERICAL · behavior_friction · contact.behavior_friction
  cf_bs_ads_exited_ts                              date,   -- DATE · cf_bs_ads_exited_ts · contact.cf_bs_ads_exited_ts
  last_inquiry_cleanup_date                        date,   -- DATE · Last Inquiry Cleanup Date · contact.last_inquiry_cleanup_date
  cf_client_master_key                             text,   -- TEXT · cf_client_master_key · contact.cf_client_master_key
  inquiry_status                                   text,   -- SINGLE_OPTIONS · Inquiry Status · contact.inquiry_status
  analyzer_path                                    text,   -- SINGLE_OPTIONS · Analyzer Path · contact.analyzer_path
  cf_remote_session_datetime                       date,   -- DATE · cf_remote_session_datetime · contact.cf_remote_session_datetime
  repair_letter_url_personal_info_dispute_eq       text,   -- TEXT · Repair Letter URL — Personal Info Dispute — EQ · contact.repair_letter_url__personal_info_dispute__eq
  behavior_intent                                  numeric,   -- NUMERICAL · behavior_intent · contact.behavior_intent
  cf_svy_annual_income_range                       text,   -- SINGLE_OPTIONS · cf_svy_annual_income_range · contact.cf_svy_annual_income_range
  cf_svy_money_change_now                          text[],   -- MULTIPLE_OPTIONS · cf_svy_money_change_now · contact.cf_svy_money_change_now
  cf_potential_commission                          text,   -- MONETORY · cf_potential_commission · contact.cf_potential_commission
  cf_inbox_forwarding_verified                     text[],   -- CHECKBOX · Inbox Forwarding Verified · contact.cf_inbox_forwarding_verified
  approvals_count                                  numeric,   -- NUMERICAL · Approvals Count · contact.approvals_count
  cf_full_legal_name                               text,   -- TEXT · cf_full_legal_name · contact.cf_full_legal_name
  letters_ready                                    text[],   -- CHECKBOX · Letters Ready · contact.letters_ready
  repair_letter_url_personal_info_dispute_tu       text,   -- TEXT · Repair Letter URL — Personal Info Dispute — TU · contact.repair_letter_url__personal_info_dispute__tu
  business_available                               text[],   -- CHECKBOX · business_available · contact.business_available
  analyzer_result_type                             text,   -- TEXT · analyzer_result_type · contact.analyzer_result_type
  fraud_alert_present                              text[],   -- CHECKBOX · Fraud Alert Present · contact.fraud_alert_present
  utm_content                                      text,   -- TEXT · utm_content · contact.utm_content
  funding_email_forwarding_address                 text,   -- TEXT · Funding Email Forwarding Address · contact.funding_email_forwarding_address
  multi_dropdown_97l1                              text[],   -- MULTIPLE_OPTIONS · Multi Dropdown 97l1 · contact.multi_dropdown_97l1
  cf_remote_connect_now                            text[],   -- CHECKBOX · cf_remote_connect_now · contact.cf_remote_connect_now
  customer_responsiveness                          text,   -- SINGLE_OPTIONS · Customer Responsiveness · contact.customer_responsiveness
  repair_what_matters_most                         text,   -- TEXT · repair_what_matters_most · contact.repair_what_matters_most
  fraud_alert_cleared_date                         date,   -- DATE · Fraud Alert Cleared Date · contact.fraud_alert_cleared_date
  funding_condition_description                    text,   -- LARGE_TEXT · Funding Condition Description · contact.funding_condition_description
  business_prep_summary_url                        text,   -- TEXT · business_prep_summary_url · contact.business_prep_summary_url
  cf_bs_video_click_count                          numeric,   -- NUMERICAL · cf_bs_video_click_count · contact.cf_bs_video_click_count
  analyzer_score                                   numeric,   -- NUMERICAL · Analyzer Score · contact.analyzer_score
  repair_letter_url_round_1_eq                     text,   -- TEXT · Repair Letter URL — Round 1 — EQ · contact.repair_letter_url__round_1__eq
  cf_svy_income_verifiable                         text,   -- SINGLE_OPTIONS · cf_svy_income_verifiable · contact.cf_svy_income_verifiable
  repair_letter_url_personal_info_dispute_ex       text,   -- TEXT · Repair Letter URL — Personal Info Dispute — EX · contact.repair_letter_url__personal_info_dispute__ex
  repair_deposit_amount                            text,   -- MONETORY · Repair Deposit Amount · contact.repair_deposit_amount
  cf_negative_case_status                          text,   -- SINGLE_OPTIONS · cf_negative_case_status · contact.cf_negative_case_status
  first_touch_url                                  text,   -- TEXT · First Touch URL · contact.first_touch_url
  cf_bs_manual_outreach_last_touch_ts              date,   -- DATE · cf_bs_manual_outreach_last_touch_ts · contact.cf_bs_manual_outreach_last_touch_ts
  funding_letter_url_inquiry_cleanup_eq            text,   -- TEXT · Funding Letter URL — Inquiry Cleanup — EQ · contact.funding_letter_url__inquiry_cleanup__eq
  ai_call_target_bureaus                           text,   -- TEXT · AI Call Target Bureaus · contact.ai_call_target_bureaus
  clarity_first                                    text,   -- TEXT · clarity_first · contact.clarity_first
  income_verifiable                                text,   -- TEXT · income_verifiable · contact.income_verifiable
  cf_funding_commission_earned                     text,   -- MONETORY · cf_funding_commission_earned · contact.cf_funding_commission_earned
  df_raw                                           text,   -- LARGE_TEXT · df_raw · contact.df_raw
  cf_pod_name                                      text,   -- SINGLE_OPTIONS · cf_pod_name · contact.cf_pod_name
  df_case_id                                       text,   -- TEXT · df_case_id · contact.df_case_id
  pod_assigned                                     text,   -- TEXT · Pod Assigned · contact.pod_assigned
  repair_why                                       text,   -- TEXT · repair_why · contact.repair_why
  repair_round_number                              numeric,   -- NUMERICAL · Repair Round Number · contact.repair_round_number
  age_of_business                                  text,   -- SINGLE_OPTIONS · Age of Business · contact.age_of_business
  cf_negative_resolution_path                      text,   -- SINGLE_OPTIONS · cf_negative_resolution_path · contact.cf_negative_resolution_path
  primary_inquiries_ex                             numeric,   -- NUMERICAL · Primary Inquiries EX · contact.primary_inquiries_ex
  repair_letter_url_round_3_ex                     text,   -- TEXT · Repair Letter URL — Round 3 — EX · contact.repair_letter_url__round_3__ex
  docs_received                                    text[],   -- CHECKBOX · Docs Received · contact.docs_received
  cf_service_selected                              text,   -- TEXT · cf_service_selected · contact.cf_service_selected
  cf_last_progress_timestamp                       date,   -- DATE · cf_last_progress_timestamp · contact.cf_last_progress_timestamp
  cf_offer_variant                                 text,   -- TEXT · cf_offer_variant · contact.cf_offer_variant
  repair_delivery_sent                             text[],   -- CHECKBOX · Repair Delivery Sent · contact.repair_delivery_sent
  cf_weighted_value                                text,   -- MONETORY · cf_weighted_value · contact.cf_weighted_value
  cf_negative_quote_accepted_at                    date,   -- DATE · cf_negative_quote_accepted_at · contact.cf_negative_quote_accepted_at
  affiliate_payout_status                          text,   -- SINGLE_OPTIONS · Affiliate Payout Status · contact.affiliate_payout_status
  cf_svy_what_matters_most                         text,   -- SINGLE_OPTIONS · cf_svy_what_matters_most · contact.cf_svy_what_matters_most
  lead_magnet_type                                 text,   -- SINGLE_OPTIONS · Lead Magnet Type · contact.lead_magnet_type
  affiliate_balance_due                            text,   -- MONETORY · Affiliate Balance Due · contact.affiliate_balance_due
  cf_graduation_date                               date,   -- DATE · cf_graduation_date · contact.cf_graduation_date
  utm_medium                                       text,   -- TEXT · utm_medium · contact.utm_medium
  cf_pre_call_backend_active                       text,   -- SINGLE_OPTIONS · cf_pre_call_backend_active · contact.cf_pre_call_backend_active
  multi_dropdown_21tf                              text[],   -- MULTIPLE_OPTIONS · Multi Dropdown 21tf · contact.multi_dropdown_21tf
  cf_graduation_status                             text,   -- SINGLE_OPTIONS · cf_graduation_status · contact.cf_graduation_status
  cf_funding_scope                                 text,   -- SINGLE_OPTIONS · cf_funding_scope · contact.cf_funding_scope
  cf_bank_event_type                               text,   -- TEXT · Bank Event Type · contact.cf_bank_event_type
  cf_sales_user_id                                 text,   -- TEXT · cf_sales_user_id · contact.cf_sales_user_id
  cf_svy_self_reported_fico                        text,   -- SINGLE_OPTIONS · cf_svy_self_reported_fico · contact.cf_svy_self_reported_fico
  cf_bs_precall_status                             text,   -- SINGLE_OPTIONS · cf_bs_precall_status · contact.cf_bs_precall_status
  business_age_months                              numeric,   -- NUMERICAL · business_age_months · contact.business_age_months
  funding_fee_locked                               text[],   -- CHECKBOX · Funding Fee Locked · contact.funding_fee_locked
  cf_reanalyzer_report_url                         text,   -- TEXT · cf_reanalyzer_report_url · contact.cf_reanalyzer_report_url
  outcome_tier                                     text,   -- TEXT · outcome_tier · contact.outcome_tier
  repair_letter_url_round_2_tu                     text,   -- TEXT · Repair Letter URL — Round 2 — TU · contact.repair_letter_url__round_2__tu
  sales_outcome                                    text,   -- SINGLE_OPTIONS · Sales Outcome · contact.sales_outcome
  cf_analysis_required                             text[],   -- CHECKBOX · cf_analysis_required · contact.cf_analysis_required
  multi_dropdown_553n                              text[],   -- MULTIPLE_OPTIONS · Multi Dropdown 553n · contact.multi_dropdown_553n
  cf_crs_softpull_consent                          text,   -- SINGLE_OPTIONS · cf_crs_softpull_consent · contact.cf_crs_softpull_consent
  cf_bs_ads_entered_ts                             date,   -- DATE · cf_bs_ads_entered_ts · contact.cf_bs_ads_entered_ts
  ai_packet_version                                text,   -- TEXT · AI Packet Version · contact.ai_packet_version
  ai_call_needed_eq                                text[],   -- CHECKBOX · AI Call Needed EQ · contact.ai_call_needed_eq
  cf_remote_session_readiness_check                text,   -- SINGLE_OPTIONS · cf_remote_session_readiness_check · contact.cf_remote_session_readiness_check
  funding_summary_url                              text,   -- TEXT · funding_summary_url · contact.funding_summary_url
  cf_contract_value                                text,   -- MONETORY · cf_contract_value · contact.cf_contract_value
  funding_locked_date                              date,   -- DATE · Funding Locked Date · contact.funding_locked_date
  cf_funnel_family                                 text,   -- TEXT · cf_funnel_family · contact.cf_funnel_family
  total_funding_estimate                           text,   -- MONETORY · total_funding_estimate · contact.total_funding_estimate
  cf_remote_connect_link                           text,   -- TEXT · cf_remote_connect_link · contact.cf_remote_connect_link
  utm_campaign                                     text,   -- TEXT · utm_campaign · contact.utm_campaign
  how_much_funding_does_your_business_need         text,   -- SINGLE_OPTIONS · How much funding does your business need? · contact.how_much_funding_does_your_business_need
  analyzer_report_url                              text,   -- TEXT · Analyzer Report URL · contact.analyzer_report_url
  full_legal_name                                  text,   -- TEXT · Full Legal Name · contact.full_legal_name
  cf_diy_charge_amount                             text,   -- MONETORY · cf_diy_charge_amount · contact.cf_diy_charge_amount
  funding_letter_url_personal_info_cleanup_eq      text,   -- TEXT · Funding Letter URL — Personal Info Cleanup — EQ · contact.funding_letter_url__personal_info_cleanup__eq
  funding_letter_url_inquiry_cleanup_tu            text,   -- TEXT · Funding Letter URL — Inquiry Cleanup — TU · contact.funding_letter_url__inquiry_cleanup__tu
  ai_call_needed_ex                                text[],   -- CHECKBOX · AI Call Needed EX · contact.ai_call_needed_ex
  next_payment_due_date                            date,   -- DATE · Next Payment Due Date · contact.next_payment_due_date
  cf_crs_softpull_consent_at                       date,   -- DATE · cf_crs_softpull_consent_at · contact.cf_crs_softpull_consent_at
  funding_fee_locked_timestamp                     date,   -- DATE · Funding Fee Locked Timestamp · contact.funding_fee_locked_timestamp
  cf_decision_status                               text,   -- SINGLE_OPTIONS · cf_decision_status · contact.cf_decision_status
  funding_target_amount                            text,   -- TEXT · funding_target_amount · contact.funding_target_amount
  ai_call_packet_ex                                text,   -- LARGE_TEXT · AI Call Packet EX · contact.ai_call_packet_ex
  cf_payment_method                                text,   -- TEXT · cf_payment_method · contact.cf_payment_method
  ai_call_packet_eq                                text,   -- LARGE_TEXT · AI Call Packet EQ · contact.ai_call_packet_eq
  funding_delivery_sent                            text[],   -- CHECKBOX · Funding Delivery Sent · contact.funding_delivery_sent
  cf_diy_status                                    text,   -- SINGLE_OPTIONS · cf_diy_status · contact.cf_diy_status
  cf_svy_funding_target_amount                     text,   -- SINGLE_OPTIONS · cf_svy_funding_target_amount · contact.cf_svy_funding_target_amount
  repair_plan_summary_url                          text,   -- TEXT · repair_plan_summary_url · contact.repair_plan_summary_url
  repair_amount_paid                               text,   -- MONETORY · Repair Amount Paid · contact.repair_amount_paid
  cf_entry_mode                                    text,   -- TEXT · cf_entry_mode · contact.cf_entry_mode
  what_will_the_funding_be_used_for                text,   -- SINGLE_OPTIONS · What will the funding be used for? · contact.what_will_the_funding_be_used_for
  customer_friction_level                          text,   -- SINGLE_OPTIONS · Customer Friction Level · contact.customer_friction_level
  repair_deposit_required_bool                     text,   -- SINGLE_OPTIONS · Repair Deposit Required (Bool) · contact.repair_deposit_required_bool
  cf_reanalyzer_prequal_amount                     text,   -- MONETORY · cf_reanalyzer_prequal_amount · contact.cf_reanalyzer_prequal_amount
  cf_call_outcome                                  text,   -- SINGLE_OPTIONS · cf_call_outcome · contact.cf_call_outcome
  cf_call_confirmed                                text[],   -- CHECKBOX · cf_call_confirmed · contact.cf_call_confirmed
  funding_letter_url_inquiry_cleanup_ex            text,   -- TEXT · Funding Letter URL — Inquiry Cleanup — EX · contact.funding_letter_url__inquiry_cleanup__ex
  business_state                                   text,   -- TEXT · Business State · contact.business_state
  analyzer_issues_summary                          text,   -- LARGE_TEXT · Analyzer Issues Summary · contact.analyzer_issues_summary
  annual_income_range                              text,   -- TEXT · annual_income_range · contact.annual_income_range
  id_uploaded                                      text[],   -- CHECKBOX · ID Uploaded · contact.id_uploaded
  bureau_count                                     numeric,   -- NUMERICAL · bureau_count · contact.bureau_count
  funding_planned_use                              text,   -- TEXT · funding_planned_use · contact.funding_planned_use
  df_client_id                                     text,   -- TEXT · df_client_id · contact.df_client_id
  primary_inquiries_eq                             numeric,   -- NUMERICAL · Primary Inquiries EQ · contact.primary_inquiries_eq
  primary_fico_score                               numeric,   -- NUMERICAL · Primary FICO Score · contact.primary_fico_score
  cf_bs_last_video_clicked                         text,   -- SINGLE_OPTIONS · cf_bs_last_video_clicked · contact.cf_bs_last_video_clicked
  document_status                                  text,   -- SINGLE_OPTIONS · Document Status · contact.document_status
  repair_letter_url_round_3_tu                     text,   -- TEXT · Repair Letter URL — Round 3 — TU · contact.repair_letter_url__round_3__tu
  total_approved_amount                            text,   -- MONETORY · Total Approved Amount · contact.total_approved_amount
  ai_call_master_status                            text,   -- SINGLE_OPTIONS · AI Call Master Status · contact.ai_call_master_status
  behavior_composite                               numeric,   -- NUMERICAL · behavior_composite · contact.behavior_composite
  cf_svy_clarity_first                             text,   -- SINGLE_OPTIONS · cf_svy_clarity_first · contact.cf_svy_clarity_first
  df_event                                         text,   -- TEXT · df_event · contact.df_event
  cf_analysis_components_requested                 text,   -- TEXT · cf_analysis_components_requested · contact.cf_analysis_components_requested
  affiliate_last_activity_date                     date   -- DATE · Affiliate Last Activity Date · contact.affiliate_last_activity_date
);

CREATE INDEX IF NOT EXISTS idx_ccf_org ON client_custom_fields(org_id);

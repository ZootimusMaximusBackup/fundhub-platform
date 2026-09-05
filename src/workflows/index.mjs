import { registerRepairHandlers } from '../repair/register.mjs';
registerRepairHandlers();
import { arCollections } from './ar-collections.mjs';
import { af01AffiliateDrip } from './af-01-affiliate-drip.mjs';
import { af02ReferralOwnershipCapture } from './af-02-referral-ownership-capture.mjs';
import { aiSet01JoshSetter } from './ai-set-01-josh-setter.mjs';
import { aiSet03NoAnswerCadence } from './ai-set-03-no-answer-cadence.mjs';
import { aiSet043WayHandoff } from './ai-set-04-3way-handoff.mjs';
import { at01FirstTouchCapture } from './at-01-first-touch-capture.mjs';
import { bc01CustomerResponsiveness } from './bc-01-customer-responsiveness.mjs';
import { bc02CustomerFriction } from './bc-02-customer-friction.mjs';
import { blakeLeadWatch } from './blake-lead-watch.mjs';
import { bs01PrecallLauncher } from './bs-01-precall-launcher.mjs';
import { contractChaser } from './contract-chaser.mjs';
import { dailyPulse } from './daily-pulse.mjs';
import { messageDispatchSweeper } from './message-dispatch-sweeper.mjs';
import { hiringBenchSweeper } from './hiring-bench-sweeper.mjs';
import { meetTranscriptSweeper } from './meet-transcript-sweeper.mjs';
import { subscriptionBillingSweeper } from './subscription-billing-sweeper.mjs';
import { partnerProductionFloorReview } from './partner-production-floor.mjs';
import { c00CrsSoftPullRequest } from './c-00-crs-soft-pull-request.mjs';
import { c02InquiryCreated } from './c-02-inquiry-created.mjs';
import { c02bInquiryRemovalRequested } from './c-02b-inquiry-removal-requested.mjs';
import { c03InquiryRemovedResumeOrHold } from './c-03-inquiry-removed-resume-or-hold.mjs';
import { c05PreFundingReview } from './c-05-pre-funding-review.mjs';
import { c06CrsResultsRouter } from './c-06-crs-results-router.mjs';
import { dpc01AnalyzerLock } from './dpc-01-analyzer-lock.mjs';
import { dpc02CallOutcomeEnforcement } from './dpc-02-call-outcome-enforcement.mjs';
import { dpc03InboundReplyRouter } from './dpc-03-inbound-reply-router.mjs';
import { dpc05NoProgressEscalation } from './dpc-05-no-progress-escalation.mjs';
import { ds01RepairReferral } from './ds-01-repair-referral.mjs';
import { ds02DiyLetters } from './ds-02-diy-letters.mjs';
import { f01FundingIntake } from './f-01-funding-intake.mjs';
import { f02PortalIdMissing } from './f-02-portal-id-missing.mjs';
import { f03RoundSubmitted } from './f-03-round-submitted.mjs';
import { f04RoundApprovals } from './f-04-round-approvals.mjs';
import { f05InquiryCleanupGate } from './f-05-inquiry-cleanup-gate.mjs';
import { f06FundingConditionsMissingDocs } from './f-06-funding-conditions-missing-docs.mjs';
import { f07FundingLocked } from './f-07-funding-locked.mjs';
import { f08PostFundingMonitoring } from './f-08-post-funding-monitoring.mjs';
import { f09FundingDeclinedNoPath } from './f-09-funding-declined-no-path.mjs';
import { f10ClientFundingInboxProvisioner } from './f-10-client-funding-inbox-provisioner.mjs';
import { f11BankEmailEventRouter } from './f-11-bank-email-event-router.mjs';
import { ghlDocDocumentCheck } from './ghl-doc-document-check.mjs';
import { inquiryCallSweeper } from './inquiry-call-sweeper.mjs';
import { n01ColdNurture } from './n-01-cold-nurture.mjs';
import { n02WarmNurture } from './n-02-warm-nurture.mjs';
import { n03HotNurture } from './n-03-hot-nurture.mjs';
import { n04PostFundingNurture } from './n-04-post-funding-nurture.mjs';
import { n06RenewalSecondWave } from './n-06-renewal-second-wave.mjs';
import { repairBureauResponseReader } from './repair-bureau-response.mjs';
import { roundStartedClientNotify } from './round-started-client-notify.mjs';
import { s01NewLeadIntake } from './s-01-new-lead-intake.mjs';
import { s00Welcome } from './s-00-welcome.mjs';
import { s02IncompleteSurveyNudge } from './s-02-incomplete-survey-nudge.mjs';
import { s04CallBooked } from './s-04-call-booked.mjs';
import { s04bBookingReminders } from './s-04b-booking-reminders.mjs';
import { s04cStaffBookedAlert } from './s-04c-staff-booked-alert.mjs';
import { sPortalInvite } from './s-portal-invite.mjs';
import { s05aNoShowRecovery } from './s-05a-no-show-recovery.mjs';
import { sNobookChase } from './s-nobook-chase.mjs';
import { s06PostCallFundingPurchased } from './s-06-post-call-funding-purchased.mjs';
import { sDocCollection } from './s-doc-collection.mjs';
import { s08PostCallFundingDeclined } from './s-08-post-call-funding-declined.mjs';
import { sOfferBucket } from './s-offer-bucket.mjs';
import { sys01ClientValueCalculator } from './sys-01-client-value-calculator.mjs';
import { sys01LtvCalculator } from './sys-01-ltv-calculator.mjs';
import { u02AnalyzerCompleteDelivery } from './u-02-analyzer-complete-delivery.mjs';
import { u03CrsSnapshotSync } from './u-03-crs-snapshot-sync.mjs';
import { u04PromoteCrsPrimary } from './u-04-promote-crs-primary.mjs';
import { u05DataHealthMonitor } from './u-05-data-health-monitor.mjs';

export const functions = [
  af01AffiliateDrip,
  af02ReferralOwnershipCapture,
  aiSet01JoshSetter,
  aiSet03NoAnswerCadence,
  aiSet043WayHandoff,
  arCollections,
  at01FirstTouchCapture,
  bc01CustomerResponsiveness,
  bc02CustomerFriction,
  /* Blake referral mail → staff text to Chris (name + phone). Never texts the lead. */
  blakeLeadWatch,
  bs01PrecallLauncher,
  /* Contracts — chase unsigned, daily.

     REGISTERING A FUNCTION IS NOT THE SEND SWITCH, but it is no longer a no-op
     either: INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY are both set on the live
     deploy (verified by name 2026-08-19), the app is synced, and Inngest has
     executed functions in production. Anything in this array can run.

     The chaser also runs today WITHOUT Inngest, through
     /api/contracts { action: "run_reminders" } — see its header. */
  contractChaser,
  /* Daily pulse — 7:00 a.m. America/Denver (cron 0 13 * * * during MDT).
     Audit only. Recon AG-07 runtime. Does not auto-fix. */
  dailyPulse,

  /* THE OUTBOUND DRAIN. Registered 2026-08-02, and it is the reason any client
     email leaves this platform at all — twenty-six workflows queue mail and
     until now nothing drained the queue.

     REGISTERING IT IS NOT THE SEND SWITCH. The switch is per company and lives in
     messaging_settings.outbound_enabled (119), visible and changeable in the
     CRM; src/messaging/outbox.mjs enforces it and a daily cap on every pass,
     scheduled or manual. The compliance gate runs on every message underneath
     both. And with no provider credentials nothing leaves whatever any of it
     says — that is the real control and always was.

     The file's own header carries the full reasoning for what moved. */
  messageDispatchSweeper,

  /* THE ONLY THING THAT ASKS "SHOULD WE BE HIRING" WITHOUT BEING ASKED FIRST.
     Registered 2026-09-05. src/hiring/bench.mjs has argued since 051 that
     recruiting has to be always-on — you notice the bench is thin when somebody
     quits, and then you hire needy — and nothing had ever run it. Its only door
     was GET /api/hiring/bench, a read-only screen docs/WIRING-AUDIT.md records
     as never called by any front end. So the always-on pipeline was on-demand.

     REGISTERING IT WRITES TASKS AND NOTHING ELSE. No candidate is contacted,
     advanced, ranked or rejected (051 forbids a software rejection outright), no
     job is posted, nothing is emailed or texted. Each alert routes through
     src/hiring/owner.mjs assigneeFor, so it lands with the sales manager or the
     owner per the rule in migration 294 rather than in one shared queue. The task
     dedupe key carries the date, so the ceiling is one task per role per day
     whatever the schedule says.

     NOT SCHEDULED, DELIBERATELY: src/ops/hire-closer.mjs actOnPacked — the
     packed-calendar rule. It is closer-only, it routes past the resolver, and
     every run posts to LinkedIn, which has no partner access. It stays behind
     POST /api/ops/hire-closer where a human presses it. The sweeper's header
     carries the full reasoning. */
  hiringBenchSweeper,
  meetTranscriptSweeper,

  /* THE RECURRING BILLING RAIL. Registered 2026-08-31. Until it, nothing in
     this platform charged a card on a cycle: 075_subscriptions.sql recorded the
     arrangement and said so in its own header, so a client or a partner could
     sit `active` on a priced plan that never billed and nothing could tell the
     difference between that and one that was paid up.

     REGISTERING IT DOES NOT CHARGE ANYBODY, and that is the state of the
     processor rather than a disclaimer. Commas' confirmed surface is
     GET /payments/:id and POST /checkout-sessions — a read and a link a human
     clicks. There is no merchant-initiated "charge the stored token" call, so
     src/subscriptions/charger.mjs ships with an EMPTY charge registry and every
     pass reports "N due, N skipped, no charger configured".

     Two locks in front of the day one exists: a charger has to be registered,
     AND SUBSCRIPTION_BILLING_ENABLED must be exactly "true". The same gate
     message-dispatch-sweeper.mjs describes — it moves, it does not disappear.

     COMPLIANCE REVIEW REQUIRED: payment rails and fee timing. */
  subscriptionBillingSweeper,

  /* THE ONLY FILTER ON THE PARTNER BASE. Registered 2026-08-31. The $10,000 entry
     fee is financeable down to a 405 FICO (W0-decisions.md), so entry screens
     nobody and production is the whole quality control: ten funding clients a
     month, on the ladder in W1-money-model.md §6. Runs on the 1st.

     REGISTERING IT CAN LOWER A PARTNER'S SHARE FROM 50 TO 20 — and cannot restate
     one cent already earned, because partner_revenue.share_pct_applied is frozen
     on every row (042). It also reaches nobody until a partner has an
     activated_at: every partner active before 282 has that column NULL on purpose,
     and src/partners/floors.mjs refuses to score a partner whose start date is
     unknown rather than guessing it.

     It never touches partners.status — 'paused' blocks payouts through 042's
     trigger, which would withhold money the partner genuinely earned.

     COMPLIANCE REVIEW REQUIRED: automatic change to a revenue-share percentage. */
  partnerProductionFloorReview,
  c00CrsSoftPullRequest,
  c02InquiryCreated,
  c02bInquiryRemovalRequested,
  c03InquiryRemovedResumeOrHold,
  c05PreFundingReview,
  c06CrsResultsRouter,
  dpc01AnalyzerLock,
  dpc02CallOutcomeEnforcement,
  dpc03InboundReplyRouter,
  dpc05NoProgressEscalation,
  ds01RepairReferral,
  ds02DiyLetters,
  f01FundingIntake,
  f02PortalIdMissing,
  f03RoundSubmitted,
  f04RoundApprovals,
  f05InquiryCleanupGate,
  f06FundingConditionsMissingDocs,
  f07FundingLocked,
  f08PostFundingMonitoring,
  f09FundingDeclinedNoPath,
  f10ClientFundingInboxProvisioner,
  f11BankEmailEventRouter,
  ghlDocDocumentCheck,
  /* Bureau dispute calls, every 15 minutes. Its own header said "not registered
     until owner enables the schedule" — that gate was implemented as "leave it
     out of this array", which made it invisible on the Automations screen and
     is the drift index.test.mjs now guards against. Owner enabled it
     2026-08-19. It places real calls. */
  inquiryCallSweeper,
  n01ColdNurture,
  n02WarmNurture,
  n03HotNurture,
  n04PostFundingNurture,
  n06RenewalSecondWave,
  repairBureauResponseReader,
  roundStartedClientNotify,
  s01NewLeadIntake,
  s00Welcome,
  /* Chases a lead who started an application and stopped: 20-minute sleep, then
     one nudge email if survey.submitted has not fired. entry.captured has 400
     rows and nothing was listening. Owner enabled it 2026-08-19. It emails real
     leads (subject to messaging_settings.outbound_enabled and the live fence). */
  s02IncompleteSurveyNudge,
  s04CallBooked,
  s04bBookingReminders,
  s04cStaffBookedAlert,
  sPortalInvite,
  sNobookChase,
  s05aNoShowRecovery,
  s06PostCallFundingPurchased,
  sDocCollection,
  s08PostCallFundingDeclined,
  sOfferBucket,
  sys01ClientValueCalculator,
  sys01LtvCalculator,
  u02AnalyzerCompleteDelivery,
  u03CrsSnapshotSync,
  u04PromoteCrsPrimary,
  u05DataHealthMonitor,
];

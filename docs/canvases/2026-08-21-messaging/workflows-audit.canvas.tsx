import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  CollapsibleSection,
  Divider,
  H1,
  Pill,
  Row,
  Select,
  Spacer,
  Stack,
  Stat,
  Text,
  TextArea,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

type Decision = "" | "KEEP" | "CHANGE" | "KILL" | "WRONG-TIME";

type Workflow = {
  id: string;
  name: string;
  stage: string;
  kind: "agentic" | "non-agentic";
  trigger: string;
  timing: string;
  templates: string;
  blurb: string;
};

type Edit = {
  decision: Decision;
  notes: string;
};

const DECISION_OPTIONS = [
  { value: "", label: "Decide…" },
  { value: "KEEP", label: "KEEP" },
  { value: "CHANGE", label: "CHANGE" },
  { value: "KILL", label: "KILL" },
  { value: "WRONG-TIME", label: "WRONG-TIME" },
];

const STAGES = [
  "Entry",
  "Survey",
  "Book",
  "Precall",
  "Call",
  "Deposit",
  "Analyzer / CRS",
  "Repair",
  "Funding",
  "Nurture",
  "System",
] as const;

/** Registered Inngest workflows from src/workflows/index.mjs + C-timing-audit.md (2026-08-21). */
const WORKFLOWS: Workflow[] = [
  // Entry
  {
    id: "s-01-new-lead-intake",
    name: "New lead intake",
    stage: "Entry",
    kind: "non-agentic",
    trigger: "entry.captured",
    timing: "Immediate — no wait",
    templates: "— (tags + pipeline card only)",
    blurb: "Creates lifecycle status and puts the lead on the sales board.",
  },
  {
    id: "at-01-first-touch-capture",
    name: "First-touch capture",
    stage: "Entry",
    kind: "non-agentic",
    trigger: "entry.captured",
    timing: "Immediate — no wait",
    templates: "—",
    blurb: "Locks first-touch attribution so later sources do not overwrite it.",
  },
  {
    id: "af-02-referral-ownership-capture",
    name: "Referral ownership capture",
    stage: "Entry",
    kind: "non-agentic",
    trigger: "entry.captured, diagnostic.paid, analysis.completed",
    timing: "Immediate — no wait",
    templates: "—",
    blurb: "Records which affiliate owns the lead across entry / paid / analysis events.",
  },
  {
    id: "n-01-cold-nurture",
    name: "Cold nurture",
    stage: "Entry",
    kind: "non-agentic",
    trigger: "entry.captured",
    timing: "Immediate enroll (sequence timing inside templates)",
    templates: "EMAIL-N01-COLD-NURTURE, SMS-N01-COLD-NURTURE",
    blurb: "Long-term cold nurture for people who just entered.",
  },
  {
    id: "s-02-incomplete-survey-nudge",
    name: "Incomplete survey nudge",
    stage: "Entry",
    kind: "non-agentic",
    trigger: "entry.captured",
    timing: "Wait 20 minutes, then email if survey not done",
    templates: "EMAIL-S02-FINISH-APPLICATION",
    blurb: "One email chase when someone starts and stalls on the application.",
  },

  // Survey
  {
    id: "n-02-warm-nurture",
    name: "Warm nurture",
    stage: "Survey",
    kind: "non-agentic",
    trigger: "survey.submitted",
    timing: "Immediate enroll",
    templates: "EMAIL-N02-WARM-NURTURE, SMS-N02-WARM-NURTURE",
    blurb: "Warm nurture after survey. Fires alongside never-booked chase.",
  },
  {
    id: "s-nobook-chase",
    name: "Never-booked chase",
    stage: "Survey",
    kind: "non-agentic",
    trigger: "survey.submitted",
    timing: "SMS at +2h, +24h, +72h (stops if they book)",
    templates: "SMS-NOBOOK-01, SMS-NOBOOK-02, SMS-NOBOOK-03",
    blurb: "Three texts when survey is done but they never book a call.",
  },

  // Book
  {
    id: "s-04-call-booked",
    name: "Call booked (pipeline move)",
    stage: "Book",
    kind: "non-agentic",
    trigger: "booking.created",
    timing: "Immediate — no wait",
    templates: "— (tags + move card to booked)",
    blurb: "Moves the sales card to booked when a calendar booking lands.",
  },
  {
    id: "s-04b-booking-reminders",
    name: "Booking confirm + reminders",
    stage: "Book",
    kind: "non-agentic",
    trigger: "booking.created",
    timing: "Confirm now; remind T−24h and T−2h (skips if call already held)",
    templates: "SMS-S04-01-CONFIRM, SMS-S04-02-REMIND-24H, SMS-S04-03-REMIND-2H",
    blurb: "Confirm text plus two reminders. Day-of can overlap BS-01 DAYOF.",
  },
  {
    id: "n-03-hot-nurture",
    name: "Hot nurture",
    stage: "Book",
    kind: "non-agentic",
    trigger: "booking.created, call.completed",
    timing: "Immediate enroll",
    templates: "EMAIL-N03-HOT-NURTURE, SMS-N03-HOT-NURTURE",
    blurb: "Hot nurture when they book or finish a call.",
  },
  {
    id: "ai-set-04-3way-handoff",
    name: "3-way text handoff",
    stage: "Book",
    kind: "non-agentic",
    trigger: "booking.created",
    timing: "Wait until T−15 minutes, then SMS",
    templates: "SMS-AISET04-HANDOFF",
    blurb: "Text handoff to advisor 15 minutes before the appointment.",
  },
  {
    id: "dpc-05-no-progress-escalation",
    name: "72-hour no-progress escalation",
    stage: "Book",
    kind: "non-agentic",
    trigger: "booking.created",
    timing: "Wait 72 hours, then email + SMS if still stuck",
    templates: "EMAIL-DPC05-NO-PROGRESS-72H, SMS-DPC05-NO-PROGRESS-72H",
    blurb: "Escalates when nothing moves for three days after booking.",
  },

  // Precall
  {
    id: "bs-01-precall-launcher",
    name: "Precall launcher (back-end sell)",
    stage: "Precall",
    kind: "non-agentic",
    trigger: "booking.created",
    timing: "Booked SMS now; precall wait; day-of at target; plus 72h email grid",
    templates:
      "SMS-BS01-01-BOOKED, SMS-BS01-02-PRECALL, SMS-BS01-03-DAYOF, BS-FUND / BS-REPAIR grids",
    blurb: "Biggest booking fan-out: three SMS + funding/repair email grid before the call.",
  },

  // Call
  {
    id: "ai-set-01-josh-setter",
    name: "Setter Josh (AI dial)",
    stage: "Call",
    kind: "agentic",
    trigger: "booking.created",
    timing: "Immediate dial (live agent prompt AG-04)",
    templates: "— (voice agent, not templated SMS/email)",
    blurb: "AI setter calls to confirm the strategy session.",
  },
  {
    id: "ai-set-03-no-answer-cadence",
    name: "No-answer SMS cadence",
    stage: "Call",
    kind: "non-agentic",
    trigger: "call.completed",
    timing: "SMS after 30m, then 2h (and planned 24h cadence)",
    templates: "SMS-AISET03-MSG1, SMS-AISET03-MSG2, SMS-AISET03-MSG3",
    blurb: "Templated SMS after a no-answer — name says AI but it is not agentic.",
  },
  {
    id: "dpc-02-call-outcome-enforcement",
    name: "Call outcome enforcement",
    stage: "Call",
    kind: "non-agentic",
    trigger: "booking.created",
    timing: "Wait until 5 minutes after appointment end, then check outcome",
    templates: "—",
    blurb: "Checks whether the call actually happened after the slot ends.",
  },
  {
    id: "s-05a-no-show-recovery",
    name: "No-show recovery",
    stage: "Call",
    kind: "non-agentic",
    trigger: "booking.noshow",
    timing: "Immediate on no-show event",
    templates: "EMAIL-S05A-NOSHOW-RECOVERY, SMS-S05A-NOSHOW-RECOVERY",
    blurb: "Email + SMS when Cal marks the booking a no-show.",
  },
  {
    id: "dpc-03-inbound-reply-router",
    name: "Inbound reply router",
    stage: "Call",
    kind: "non-agentic",
    trigger: "message.inbound",
    timing: "Immediate on inbound message",
    templates: "SMS-DPC04-RESCHEDULE-REBOOKING",
    blurb: "Routes client replies (including reschedule) and can fire a rebook SMS.",
  },
  {
    id: "s-08-post-call-funding-declined",
    name: "Post-call: did not buy funding",
    stage: "Call",
    kind: "non-agentic",
    trigger: "call.completed",
    timing: "Immediate when outcome = declined",
    templates: "— (sales tags / board only)",
    blurb: "Sales-side tagging when they decline funding on the call.",
  },

  // Deposit
  {
    id: "s-06-post-call-funding-purchased",
    name: "Post-call: funding purchased",
    stage: "Deposit",
    kind: "non-agentic",
    trigger: "deposit.paid",
    timing: "Immediate on deposit",
    templates: "— (lifecycle / board)",
    blurb: "Moves the file forward when the funding deposit clears.",
  },
  {
    id: "c-02b-inquiry-removal-requested",
    name: "Inquiry removal requested",
    stage: "Deposit",
    kind: "non-agentic",
    trigger: "deposit.paid",
    timing: "Immediate on deposit",
    templates: "—",
    blurb: "Starts inquiry-removal scheduling after deposit (auto-trigger).",
  },
  {
    id: "contract-chaser",
    name: "Contract chaser (unsigned)",
    stage: "Deposit",
    kind: "non-agentic",
    trigger: "cron daily 10:00 (also API run_reminders)",
    timing: "Daily cron 0 10 * * *",
    templates: "CONTRACT-REMIND-EMAIL (via contracts notify)",
    blurb: "Reminds people holding up an unsigned contract.",
  },

  // Analyzer / CRS
  {
    id: "c-00-crs-soft-pull-request",
    name: "CRS soft-pull request",
    stage: "Analyzer / CRS",
    kind: "non-agentic",
    trigger: "diagnostic.paid",
    timing: "Immediate after diagnostic paid",
    templates: "—",
    blurb: "Requests the soft credit pull once diagnostic is paid.",
  },
  {
    id: "u-02-analyzer-complete-delivery",
    name: "Analyzer complete delivery",
    stage: "Analyzer / CRS",
    kind: "non-agentic",
    trigger: "analysis.completed",
    timing: "Immediate on analysis complete",
    templates: "EMAIL-U02-ANALYZER-FUNDING-DELIVERY, EMAIL-U02-ANALYZER-REPAIR-DELIVERY",
    blurb: "Sends the analyzer results email (funding or repair path).",
  },
  {
    id: "u-03-crs-snapshot-sync",
    name: "CRS snapshot sync",
    stage: "Analyzer / CRS",
    kind: "non-agentic",
    trigger: "analysis.completed (source=crs)",
    timing: "Immediate",
    templates: "—",
    blurb: "Writes the CRS soft-pull snapshot into the client file.",
  },
  {
    id: "u-04-promote-crs-primary",
    name: "Promote CRS as primary",
    stage: "Analyzer / CRS",
    kind: "non-agentic",
    trigger: "analysis.completed (source=crs)",
    timing: "Immediate",
    templates: "—",
    blurb: "Makes CRS the primary snapshot once it lands (beats analyzer estimate).",
  },
  {
    id: "u-05-data-health-monitor",
    name: "Data health monitor",
    stage: "Analyzer / CRS",
    kind: "non-agentic",
    trigger: "analysis.completed",
    timing: "Immediate",
    templates: "—",
    blurb: "Flags missing critical analyzer fields (scores / utilization).",
  },
  {
    id: "dpc-01-analyzer-lock",
    name: "Analyzer lock",
    stage: "Analyzer / CRS",
    kind: "non-agentic",
    trigger: "analysis.completed",
    timing: "Immediate",
    templates: "—",
    blurb: "Locks analyzer path and progress markers after analysis.",
  },
  {
    id: "c-02-inquiry-created",
    name: "Inquiry created → assign specialist",
    stage: "Analyzer / CRS",
    kind: "non-agentic",
    trigger: "analysis.completed",
    timing: "Immediate when new inquiries in payload",
    templates: "—",
    blurb: "Logs new inquiries and assigns an inquiry specialist.",
  },
  {
    id: "c-06-crs-results-router",
    name: "CRS results router",
    stage: "Analyzer / CRS",
    kind: "non-agentic",
    trigger: "analysis.completed (source=crs)",
    timing: "Immediate; decline path sends email + SMS",
    templates: "EMAIL-C06-DECLINE, SMS-C06-DECLINE",
    blurb: "Routes CRS results; decline path notifies the client.",
  },

  // Repair
  {
    id: "ds-01-repair-referral",
    name: "Repair referral (downsell)",
    stage: "Repair",
    kind: "non-agentic",
    trigger: "call.completed",
    timing: "Immediate on call complete (repair path)",
    templates: "SMS-DS01-REPAIR-REFERRAL, EMAIL-DS01-REPAIR-REFERRAL",
    blurb: "Referral to repair partner when funding is not the path.",
  },
  {
    id: "ds-02-diy-letters",
    name: "DIY dispute letters",
    stage: "Repair",
    kind: "non-agentic",
    trigger: "payment.received",
    timing: "Immediate on DIY payment",
    templates: "EMAIL-DS02-DIY-LETTERS-READY",
    blurb: "Delivers DIY letters only on the not-qualified downsell path.",
  },
  {
    id: "repair-bureau-response-reader",
    name: "Bureau response reader",
    stage: "Repair",
    kind: "agentic",
    trigger: "docs.received",
    timing: "Immediate when bureau docs land",
    templates: "— (agent reads docs; repair notify emails separate)",
    blurb: "AI reads bureau response documents when they arrive.",
  },
  {
    id: "inquiry-call-sweeper",
    name: "Inquiry call sweeper",
    stage: "Repair",
    kind: "agentic",
    trigger: "cron every 15 minutes",
    timing: "*/15 * * * * — dials when call_due_at is due",
    templates: "— (AI bureau calls)",
    blurb: "Places AI bureau inquiry-removal calls on schedule.",
  },
  {
    id: "c-03-inquiry-removed-resume-or-hold",
    name: "Inquiry removed → resume or hold",
    stage: "Repair",
    kind: "non-agentic",
    trigger: "inquiry.removed",
    timing: "Immediate; fraud-alert gate",
    templates: "—",
    blurb: "After inquiry removal, resumes funding or holds if fraud alert.",
  },

  // Funding
  {
    id: "round-started-client-notify",
    name: "Round started — client notify",
    stage: "Funding",
    kind: "non-agentic",
    trigger: "round.started",
    timing: "Immediate SMS",
    templates: "SMS-ROUND-STARTED-NOTIFY",
    blurb: "One SMS when a funding round starts.",
  },
  {
    id: "f-01-funding-intake",
    name: "Funding intake",
    stage: "Funding",
    kind: "non-agentic",
    trigger: "round.started",
    timing: "Immediate",
    templates: "—",
    blurb: "Starts funding intake when the round opens.",
  },
  {
    id: "f-02-portal-id-missing",
    name: "Portal / ID missing nudge",
    stage: "Funding",
    kind: "non-agentic",
    trigger: "round.started",
    timing: "Wait 3 hours, then follow-up after 2 days",
    templates:
      "EMAIL-F02-ID-PORTAL-NEEDED, SMS-F02-ID-PORTAL-NEEDED, EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP",
    blurb: "Nudge when ID / portal setup is still missing after round start.",
  },
  {
    id: "f-10-client-funding-inbox-provisioner",
    name: "Client funding inbox setup",
    stage: "Funding",
    kind: "non-agentic",
    trigger: "round.started",
    timing: "Immediate",
    templates: "EMAIL-F10-INBOX-SETUP, SMS-F10-INBOX-SETUP",
    blurb: "Provisions the client funding inbox and notifies them.",
  },
  {
    id: "c-05-pre-funding-review",
    name: "Pre-funding review",
    stage: "Funding",
    kind: "non-agentic",
    trigger: "round.started",
    timing: "Immediate; checks if CRS already complete",
    templates: "—",
    blurb: "Raises pre-funding review task or flags CRS still needed.",
  },
  {
    id: "bc-01-customer-responsiveness",
    name: "Customer responsiveness score",
    stage: "Funding",
    kind: "non-agentic",
    trigger: "round.started",
    timing: "Checks at +24h and +48h",
    templates: "—",
    blurb: "Scores how fast the client responds during funding.",
  },
  {
    id: "bc-02-customer-friction",
    name: "Customer friction score",
    stage: "Funding",
    kind: "non-agentic",
    trigger: "round.started",
    timing: "Immediate",
    templates: "—",
    blurb: "Scores friction level during funding onboarding.",
  },
  {
    id: "f-03-round-submitted",
    name: "Round submitted",
    stage: "Funding",
    kind: "non-agentic",
    trigger: "round.submitted",
    timing: "Immediate",
    templates: "EMAIL-F03-ROUND-SUBMITTED, SMS-F03-ROUND-SUBMITTED",
    blurb: "Tells the client the round was submitted to lenders.",
  },
  {
    id: "f-04-round-approvals",
    name: "Round approvals",
    stage: "Funding",
    kind: "non-agentic",
    trigger: "round.approved",
    timing: "Immediate",
    templates: "EMAIL-F04-ROUND-APPROVALS, SMS-F04-ROUND-APPROVALS",
    blurb: "Notifies when approvals land on the round.",
  },
  {
    id: "f-05-inquiry-cleanup-gate",
    name: "Inquiry cleanup gate",
    stage: "Funding",
    kind: "non-agentic",
    trigger: "round.approved",
    timing: "Immediate if new inquiries exist",
    templates: "—",
    blurb: "Blocks between rounds when new inquiries need cleanup.",
  },
  {
    id: "f-06-funding-conditions-missing-docs",
    name: "Missing docs / conditions",
    stage: "Funding",
    kind: "non-agentic",
    trigger: "mail.response, docs.received",
    timing: "Immediate on mail/docs signal",
    templates: "EMAIL-F06-MISSING-DOCS, SMS-F06-MISSING-DOCS",
    blurb: "Chases missing funding conditions documents.",
  },
  {
    id: "f-07-funding-locked",
    name: "Funding locked",
    stage: "Funding",
    kind: "non-agentic",
    trigger: "round.funded",
    timing: "Immediate",
    templates: "EMAIL-F07-FUNDING-LOCKED, SMS-F07-FUNDING-LOCKED",
    blurb: "Congrats / locked-funding notice when the round funds.",
  },
  {
    id: "f-08-post-funding-monitoring",
    name: "Post-funding monitoring",
    stage: "Funding",
    kind: "non-agentic",
    trigger: "round.funded",
    timing: "Immediate (no trailing no-op wait)",
    templates: "—",
    blurb: "Internal monitoring after funds lock.",
  },
  {
    id: "f-09-funding-declined-no-path",
    name: "Funding declined / no path",
    stage: "Funding",
    kind: "non-agentic",
    trigger: "mail.response",
    timing: "Immediate on classified mail",
    templates: "—",
    blurb: "Handles the no-path / declined funding outcome from bank mail.",
  },
  {
    id: "f-11-bank-email-event-router",
    name: "Bank email event router",
    stage: "Funding",
    kind: "non-agentic",
    trigger: "mail.response",
    timing: "Immediate",
    templates: "—",
    blurb: "Classifies inbound bank mail into funding events.",
  },

  // Nurture
  {
    id: "n-04-post-funding-nurture",
    name: "Post-funding nurture",
    stage: "Nurture",
    kind: "non-agentic",
    trigger: "round.funded",
    timing: "Immediate enroll",
    templates: "EMAIL-N04-POST-FUNDING, SMS-N04-POST-FUNDING",
    blurb: "Nurture sequence after funding locks.",
  },
  {
    id: "n-06-renewal-second-wave",
    name: "Renewal / second-wave funding",
    stage: "Nurture",
    kind: "non-agentic",
    trigger: "round.funded",
    timing: "Wait 180 days (~6 months), then email + SMS",
    templates: "EMAIL-N06-RENEWAL, SMS-N06-RENEWAL",
    blurb: "Comes back six months later for renewal / second wave.",
  },

  // System
  {
    id: "message-dispatch-sweeper",
    name: "Message dispatch sweeper",
    stage: "System",
    kind: "non-agentic",
    trigger: "cron every 5 minutes",
    timing: "*/5 * * * * — drains queued messages",
    templates: "— (sends whatever workflows queued)",
    blurb: "Only drain for outbound email/SMS. If this fails, nothing leaves.",
  },
  {
    id: "sys-01-client-value-calculator",
    name: "Client value calculator",
    stage: "System",
    kind: "non-agentic",
    trigger: "round.approved",
    timing: "Immediate",
    templates: "—",
    blurb: "Internal projection metric — not client-facing.",
  },
  {
    id: "sys-01-ltv-calculator",
    name: "Lifetime value calculator",
    stage: "System",
    kind: "non-agentic",
    trigger: "round.funded",
    timing: "Immediate",
    templates: "—",
    blurb: "Adds funded amount into running lifetime value — not client-facing.",
  },
];

function decisionTone(
  d: Decision,
): "neutral" | "success" | "warning" | "deleted" | "info" {
  if (d === "KEEP") return "success";
  if (d === "CHANGE") return "warning";
  if (d === "KILL") return "deleted";
  if (d === "WRONG-TIME") return "info";
  return "neutral";
}

function defaultEdit(): Edit {
  return { decision: "", notes: "" };
}

export default function WorkflowsAuditCanvas() {
  const theme = useHostTheme();
  const [stageFilter, setStageFilter] = useCanvasState<string>("stageFilter", "__ALL__");
  const [kindFilter, setKindFilter] = useCanvasState<string>("kindFilter", "__ALL__");
  const [undecidedOnly, setUndecidedOnly] = useCanvasState<boolean>("undecidedOnly", false);
  const [edits, setEdits] = useCanvasState<Record<string, Edit>>("edits", {});
  const [exportText, setExportText] = useCanvasState<string>("exportText", "");

  const stageOptions = [
    { value: "__ALL__", label: "All stages" },
    ...STAGES.map((s) => ({ value: s, label: s })),
  ];

  const kindOptions = [
    { value: "__ALL__", label: "Agentic + non-agentic" },
    { value: "agentic", label: "Agentic only" },
    { value: "non-agentic", label: "Non-agentic only" },
  ];

  function getEdit(id: string): Edit {
    return edits[id] || defaultEdit();
  }

  function patch(id: string, partial: Partial<Edit>) {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...defaultEdit(), ...(prev[id] || {}), ...partial },
    }));
  }

  const filtered = WORKFLOWS.filter((w) => {
    if (stageFilter !== "__ALL__" && w.stage !== stageFilter) return false;
    if (kindFilter !== "__ALL__" && w.kind !== kindFilter) return false;
    if (undecidedOnly && getEdit(w.id).decision) return false;
    return true;
  });

  const decided = WORKFLOWS.filter((w) => !!edits[w.id]?.decision).length;
  const keep = WORKFLOWS.filter((w) => edits[w.id]?.decision === "KEEP").length;
  const change = WORKFLOWS.filter((w) => edits[w.id]?.decision === "CHANGE").length;
  const kill = WORKFLOWS.filter((w) => edits[w.id]?.decision === "KILL").length;
  const wrong = WORKFLOWS.filter((w) => edits[w.id]?.decision === "WRONG-TIME").length;
  const agenticCount = WORKFLOWS.filter((w) => w.kind === "agentic").length;

  const stagesToShow = STAGES.filter(
    (s) => filtered.some((w) => w.stage === s) && (stageFilter === "__ALL__" || stageFilter === s),
  );

  function exportSummary(): string {
    const lines: string[] = [
      "# Workflow audit decisions",
      "",
      `Source: registered Inngest list (${WORKFLOWS.length}) · C-timing-audit 2026-08-21`,
      `Decided: ${decided}/${WORKFLOWS.length}`,
      "",
    ];
    for (const stage of STAGES) {
      const rows = WORKFLOWS.filter((w) => w.stage === stage && edits[w.id]?.decision);
      if (!rows.length) continue;
      lines.push(`## ${stage}`);
      for (const w of rows) {
        const ed = edits[w.id]!;
        lines.push(`- ${w.id} → ${ed.decision}`);
        lines.push(`  name: ${w.name}`);
        lines.push(`  kind: ${w.kind}`);
        lines.push(`  trigger: ${w.trigger}`);
        lines.push(`  timing: ${w.timing}`);
        if (w.templates !== "—") lines.push(`  templates: ${w.templates}`);
        if (ed.notes) lines.push(`  notes: ${ed.notes}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  return (
    <Stack gap={16} style={{ padding: 16, maxWidth: 960 }}>
      <Stack gap={6}>
        <H1>Workflows audit</H1>
        <Text tone="secondary">
          Every registered automation from start to finish. Mark KEEP / CHANGE / KILL /
          WRONG-TIME, then export and paste back in chat.
        </Text>
        <Text size="small" tone="tertiary" style={{ color: theme.text.tertiary }}>
          Source: src/workflows/index.mjs + docs/workflows/messaging-review-2026-08-21-evidence/C-timing-audit.md
        </Text>
      </Stack>

      <Row gap={12} wrap>
        <Stat value={String(WORKFLOWS.length)} label="Workflows" tone="info" />
        <Stat value={`${decided}/${WORKFLOWS.length}`} label="Decided" />
        <Stat value={String(agenticCount)} label="Agentic" />
        <Stat value={String(keep)} label="KEEP" tone="success" />
        <Stat value={String(change)} label="CHANGE" tone="warning" />
        <Stat value={String(kill)} label="KILL" tone="danger" />
        <Stat value={String(wrong)} label="WRONG-TIME" />
      </Row>

      <Callout tone="warning" title="Watch these pile-ups">
        booking.created can start S-04B + BS-01 + Josh + T−15 handoff + 72h escalate (+ hot nurture).
        survey.submitted starts warm nurture + never-booked chase together. Day-of: BS-01 and S-04B
        both text around T−2h. Dispatch sweeper every 5 minutes is what actually sends queued mail/SMS.
      </Callout>

      <Card>
        <CardHeader>Filters</CardHeader>
        <CardBody>
          <Stack gap={10}>
            <Row gap={12} wrap align="center">
              <Stack gap={4} style={{ minWidth: 200 }}>
                <Text size="small" tone="secondary">
                  Stage
                </Text>
                <Select
                  value={stageFilter}
                  onChange={setStageFilter}
                  options={stageOptions}
                />
              </Stack>
              <Stack gap={4} style={{ minWidth: 200 }}>
                <Text size="small" tone="secondary">
                  Kind
                </Text>
                <Select value={kindFilter} onChange={setKindFilter} options={kindOptions} />
              </Stack>
              <Button
                variant={undecidedOnly ? "primary" : "secondary"}
                onClick={() => setUndecidedOnly(!undecidedOnly)}
              >
                {undecidedOnly ? "Showing undecided only" : "Show undecided only"}
              </Button>
            </Row>
            <Text size="small" tone="tertiary">
              Showing {filtered.length} of {WORKFLOWS.length}
            </Text>
          </Stack>
        </CardBody>
      </Card>

      {stagesToShow.map((stage) => {
        const rows = filtered.filter((w) => w.stage === stage);
        const stageDecided = rows.filter((w) => !!getEdit(w.id).decision).length;
        return (
          <div key={stage}>
            <CollapsibleSection
              title={`${stage} · ${stageDecided} marked`}
              count={rows.length}
              defaultOpen={stage === "Entry" || stageFilter === stage}
            >
              <Stack gap={10}>
                {rows.map((w) => {
                  const ed = getEdit(w.id);
                  return (
                    <div key={w.id}>
                      <Card>
                        <CardHeader
                          trailing={
                            <Row gap={6}>
                              <Pill tone={decisionTone(ed.decision)} size="sm">
                                {ed.decision || "undecided"}
                              </Pill>
                              <Pill
                                tone={w.kind === "agentic" ? "info" : "neutral"}
                                size="sm"
                              >
                                {w.kind === "agentic" ? "Agentic" : "Non-agentic"}
                              </Pill>
                            </Row>
                          }
                        >
                          {w.name}
                        </CardHeader>
                        <CardBody>
                          <Stack gap={10}>
                            <Stack gap={2}>
                              <Text size="small" tone="tertiary">
                                Workflow id
                              </Text>
                              <Text weight="semibold">{w.id}</Text>
                            </Stack>
                            <Text size="small">{w.blurb}</Text>
                            <Divider />
                            <Row gap={16} wrap>
                              <Stack gap={2} style={{ minWidth: 200, flex: 1 }}>
                                <Text size="small" tone="secondary">
                                  Starts when
                                </Text>
                                <Text size="small">{w.trigger}</Text>
                              </Stack>
                              <Stack gap={2} style={{ minWidth: 220, flex: 1 }}>
                                <Text size="small" tone="secondary">
                                  Timing / waits
                                </Text>
                                <Text size="small">{w.timing}</Text>
                              </Stack>
                            </Row>
                            <Stack gap={2}>
                              <Text size="small" tone="secondary">
                                SMS / email keys
                              </Text>
                              <Text size="small">{w.templates}</Text>
                            </Stack>
                            <Stack gap={4}>
                              <Text size="small" tone="secondary">
                                Your decision
                              </Text>
                              <Select
                                value={ed.decision}
                                onChange={(v) =>
                                  patch(w.id, { decision: v as Decision })
                                }
                                options={DECISION_OPTIONS}
                              />
                            </Stack>
                            <Row gap={6} wrap>
                              <Button
                                variant={
                                  ed.decision === "KEEP" ? "primary" : "secondary"
                                }
                                onClick={() => patch(w.id, { decision: "KEEP" })}
                              >
                                KEEP
                              </Button>
                              <Button
                                variant={
                                  ed.decision === "CHANGE" ? "primary" : "secondary"
                                }
                                onClick={() => patch(w.id, { decision: "CHANGE" })}
                              >
                                CHANGE
                              </Button>
                              <Button
                                variant={
                                  ed.decision === "KILL" ? "primary" : "secondary"
                                }
                                onClick={() => patch(w.id, { decision: "KILL" })}
                              >
                                KILL
                              </Button>
                              <Button
                                variant={
                                  ed.decision === "WRONG-TIME"
                                    ? "primary"
                                    : "secondary"
                                }
                                onClick={() =>
                                  patch(w.id, { decision: "WRONG-TIME" })
                                }
                              >
                                WRONG-TIME
                              </Button>
                            </Row>
                            <Stack gap={4}>
                              <Text size="small" tone="secondary">
                                Notes (why / new timing)
                              </Text>
                              <TextArea
                                value={ed.notes}
                                onChange={(v) => patch(w.id, { notes: v })}
                                rows={2}
                                placeholder="e.g. kill — duplicates S-04B day-of; change wait to 24h"
                              />
                            </Stack>
                          </Stack>
                        </CardBody>
                      </Card>
                    </div>
                  );
                })}
              </Stack>
            </CollapsibleSection>
          </div>
        );
      })}

      {!filtered.length ? (
        <Callout tone="warning" title="Nothing in this filter">
          Clear “undecided only” or pick another stage / kind.
        </Callout>
      ) : null}

      <Card>
        <CardHeader>Export for chat</CardHeader>
        <CardBody>
          <Stack gap={10}>
            <Text size="small" tone="secondary">
              Click Export, copy the box, paste in chat so Fixer can run only what you marked.
            </Text>
            <Row gap={8} align="center">
              <Button variant="primary" onClick={() => setExportText(exportSummary())}>
                Export decisions
              </Button>
              <Spacer />
              <Text size="small" tone="tertiary">
                {decided} decided
              </Text>
            </Row>
            {exportText ? (
              <TextArea value={exportText} onChange={setExportText} rows={12} />
            ) : null}
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}

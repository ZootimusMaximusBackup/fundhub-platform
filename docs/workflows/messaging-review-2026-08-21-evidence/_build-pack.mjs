#!/usr/bin/env node
/**
 * Read-only pack builder for messaging review.
 * Inputs: _templates.json, workflow source headers (hardcoded journey map).
 * Outputs: A-copy-inventory.md, journey-spine.md (Word source).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templates = JSON.parse(fs.readFileSync(path.join(__dirname, "_templates.json"), "utf8"));
const byKey = new Map(templates.map((t) => [t.key, t]));

function tpl(key) {
  const t = byKey.get(key);
  if (!t) return { key, missing: true, channel: "", subject: "", body: "(NOT IN LIVE DUMP)", compliance: "?" };
  return { key, missing: false, channel: t.channel, subject: t.subject, body: t.body, compliance: t.compliance };
}

function renderTpl(t) {
  const displayKey = t.requestedKey || t.key;
  if (t.missing) {
    return `**${displayKey}** — MISSING from live dump\n\nDecision: ________\n`;
  }
  const resolvedNote =
    t.resolvedFrom && t.resolvedFrom !== displayKey
      ? `\n_Body resolved from live key \`${t.resolvedFrom}\` (wired key missing)._\n`
      : "";
  const subj = t.subject ? `Subject: ${t.subject}\n` : "";
  return (
    `**${displayKey}** (${t.channel}) · compliance_passed=${t.compliance}` +
    (t.resolvedFrom && t.resolvedFrom !== displayKey ? ` · live_row=${t.resolvedFrom}` : "") +
    `\n` +
    subj +
    resolvedNote +
    `\n\`\`\`\n${String(t.body || "").trim()}\n\`\`\`\n\nDecision: ________\n`
  );
}

/** Journey-wired beats: stage → workflow → timing → keys */
const JOURNEY = [
  {
    stage: "1. Entry / lead",
    beats: [
      {
        id: "s-01",
        name: "S-01 New lead intake",
        kind: "non-agentic",
        trigger: "entry.captured",
        timing: "immediate — tags + card only (no client SMS/email)",
        keys: [],
        notes: "No sendTemplated."
      },
      {
        id: "at-01",
        name: "AT-01 First-touch attribution",
        kind: "non-agentic",
        trigger: "entry.captured",
        timing: "immediate — attribution only",
        keys: [],
        notes: "No client message."
      },
      {
        id: "af-02",
        name: "AF-02 Referral ownership",
        kind: "non-agentic",
        trigger: "lead / referral events",
        timing: "immediate — ownership only",
        keys: [],
        notes: "Affiliate emails AF* exist in DB but are not wired from this workflow."
      },
      {
        id: "n-01",
        name: "N-01 Cold nurture",
        kind: "non-agentic",
        trigger: "entry.captured",
        timing: "immediate on entry (no sleep in workflow)",
        keys: ["EMAIL-N01-COLD-NURTURE", "SMS-N01-COLD-NURTURE"]
      },
      {
        id: "s-02",
        name: "S-02 Incomplete survey nudge",
        kind: "non-agentic",
        trigger: "entry.captured",
        timing: "sleep 20m → email if survey.submitted not yet",
        keys: ["EMAIL-S02-FINISH-APPLICATION"]
      }
    ]
  },
  {
    stage: "2. Survey done / no book",
    beats: [
      {
        id: "n-02",
        name: "N-02 Warm nurture",
        kind: "non-agentic",
        trigger: "survey.submitted",
        timing: "immediate",
        keys: ["EMAIL-N02-WARM-NURTURE", "SMS-N02-WARM-NURTURE"]
      },
      {
        id: "s-nobook",
        name: "S-NOBOOK Never-booked chase",
        kind: "non-agentic",
        trigger: "survey.submitted",
        timing: "sleep 2h → SMS-01; +24h → SMS-02; +72h → SMS-03; exit on booking.created",
        keys: ["SMS-NOBOOK-01", "SMS-NOBOOK-02", "SMS-NOBOOK-03"],
        notes: "OVERLAP RISK with N-02 (same trigger)."
      }
    ]
  },
  {
    stage: "3. Booked / precall",
    beats: [
      {
        id: "s-04",
        name: "S-04 Call booked (card move)",
        kind: "non-agentic",
        trigger: "booking.created",
        timing: "immediate — CRM card only",
        keys: []
      },
      {
        id: "s-04b",
        name: "S-04B Booking confirm + reminders",
        kind: "non-agentic",
        trigger: "booking.created",
        timing: "SMS confirm immediate; sleepUntil T-24h; sleepUntil T-2h; stop if call held",
        keys: ["SMS-S04-01-CONFIRM", "SMS-S04-02-REMIND-24H", "SMS-S04-03-REMIND-2H"],
        notes: "OVERLAP RISK with BS-01 SMS (booked / precall / dayof) on same booking."
      },
      {
        id: "bs-01",
        name: "BS-01 Precall launcher (email grid + SMS)",
        kind: "non-agentic",
        trigger: "booking.created",
        timing:
          "Email: D1–D3 × E1–E6 grid (~72h), waits 12h/1h/3h/3h/4h/1h per day row; exit if call held. SMS: BOOKED immediate; PRECALL after 24h; DAYOF at appointment−2h.",
        keys: [
          "SMS-BS01-01-BOOKED",
          "SMS-BS01-02-PRECALL",
          "SMS-BS01-03-DAYOF"
        ],
        keyPrefixes: ["BS-FUND-", "BS-REPAIR-"],
        notes: "Email keys are BS-FUND-* / BS-REPAIR-* (no EMAIL- prefix). Path picks funding vs repair grid."
      },
      {
        id: "n-03",
        name: "N-03 Hot nurture",
        kind: "non-agentic",
        trigger: "booking.created / call.completed",
        timing: "immediate on trigger",
        keys: ["EMAIL-N03-HOT-NURTURE", "SMS-N03-HOT-NURTURE"],
        notes: "OVERLAP RISK with BS-01 / S-04B around booking."
      },
      {
        id: "ai-set-04",
        name: "AI-SET-04 3-way handoff SMS",
        kind: "non-agentic",
        trigger: "booking.created",
        timing: "sleepUntil T-15m → SMS + advisor task",
        keys: ["SMS-AISET04-HANDOFF"]
      },
      {
        id: "dpc-05",
        name: "DPC-05 No-progress 72h escalation",
        kind: "non-agentic",
        trigger: "booking.created",
        timing: "sleep 72h → email+SMS if no decision",
        keys: ["EMAIL-DPC05-NO-PROGRESS-72H", "SMS-DPC05-NO-PROGRESS-72H"]
      }
    ]
  },
  {
    stage: "4. Call / AI setter / no-show",
    beats: [
      {
        id: "ai-set-01",
        name: "AI-SET-01 Josh setter (Bland voice)",
        kind: "agentic",
        trigger: "booking.created",
        timing: "places Bland call (prompt from agents.prompt AG-04 or vendor SETTER_TASK)",
        keys: [],
        promptRef: "Josh setter — see B-agent-prompts"
      },
      {
        id: "ai-set-03",
        name: "AI-SET-03 No-answer SMS cadence",
        kind: "non-agentic",
        trigger: "call.completed (no_answer / voicemail)",
        timing: "SMS1 immediate; sleep 30m → SMS2; sleep 2h → SMS3; exit on rebook",
        keys: ["SMS-AISET03-MSG1", "SMS-AISET03-MSG2", "SMS-AISET03-MSG3"],
        notes: "Name says AI; copy is templated Josh voice, not live LLM."
      },
      {
        id: "dpc-02",
        name: "DPC-02 Call outcome enforcement",
        kind: "non-agentic",
        trigger: "booking end",
        timing: "sleepUntil end+5m → mark showed vs noshow",
        keys: []
      },
      {
        id: "s-05a",
        name: "S-05A No-show recovery",
        kind: "non-agentic",
        trigger: "booking.noshow",
        timing: "immediate email+SMS",
        keys: ["EMAIL-S05A-NOSHOW-RECOVERY", "SMS-S05A-NOSHOW-RECOVERY"]
      },
      {
        id: "dpc-03",
        name: "DPC-03 Inbound reply router",
        kind: "non-agentic",
        trigger: "inbound SMS keywords",
        timing: "immediate — may send reschedule SMS",
        keys: ["SMS-DPC04-RESCHEDULE-REBOOKING"]
      }
    ]
  },
  {
    stage: "5. Deposit / contract / invoice",
    beats: [
      {
        id: "s-06",
        name: "S-06 Funding purchased",
        kind: "non-agentic",
        trigger: "deposit.paid",
        timing: "immediate — tags/cards (check for messages)",
        keys: []
      },
      {
        id: "contract",
        name: "Contract send + remind + chaser",
        kind: "non-agentic",
        trigger: "contract send API + daily chaser",
        timing: "on send; reminders via CONTRACT-REMIND; chaser cron",
        keys: ["CONTRACT-SEND-EMAIL", "CONTRACT-REMIND-EMAIL"]
      },
      {
        id: "invoice",
        name: "Invoice sent",
        kind: "non-agentic",
        trigger: "invoice notify",
        timing: "on send",
        keys: ["INVOICE-SENT-EMAIL"]
      },
      {
        id: "payment-link",
        name: "Payment link notice (API)",
        kind: "non-agentic",
        trigger: "api/payment-links",
        timing: "on staff/action",
        keys: ["payment_link_notice"]
      },
      {
        id: "closer-deck",
        name: "Closer deck soft-pull / pay-link",
        kind: "non-agentic",
        trigger: "staff Present actions",
        timing: "immediate — INLINE compose (not template keys)",
        keys: [],
        notes: "Bodies live in src/sales/closer-deck.mjs — see appendix INLINE."
      },
      {
        id: "magic-link",
        name: "Portal magic link",
        kind: "non-agentic",
        trigger: "auth magic-link",
        timing: "on login request",
        keys: ["EMAIL-PORTAL-MAGIC-LINK"]
      }
    ]
  },
  {
    stage: "6. Analyzer / CRS",
    beats: [
      {
        id: "u-02",
        name: "U-02 Analyzer complete delivery",
        kind: "non-agentic",
        trigger: "analysis.completed",
        timing: "immediate funding or repair delivery email",
        keys: ["EMAIL-U02-ANALYZER-FUNDING-DELIVERY", "EMAIL-U02-ANALYZER-REPAIR-DELIVERY"]
      },
      {
        id: "c-06",
        name: "C-06 CRS results router",
        kind: "non-agentic",
        trigger: "analysis.completed",
        timing: "immediate decline path email+SMS when tier = decline",
        keys: ["EMAIL-C06-DECLINE", "SMS-C06-DECLINE"]
      },
      {
        id: "dpc-01",
        name: "DPC-01 Analyzer lock",
        kind: "non-agentic",
        trigger: "analysis.completed",
        timing: "locks path — no client message",
        keys: []
      },
      {
        id: "c-00",
        name: "C-00 CRS soft-pull request",
        kind: "non-agentic",
        trigger: "diagnostic.paid",
        timing: "marks requested — no client template",
        keys: []
      }
    ]
  },
  {
    stage: "7. Repair / DIY / downsell",
    beats: [
      {
        id: "ds-01",
        name: "DS-01 Repair referral",
        kind: "non-agentic",
        trigger: "call.completed (declined funding)",
        timing: "immediate email+SMS",
        keys: ["EMAIL-DS01-REPAIR-REFERRAL", "SMS-DS01-REPAIR-REFERRAL"]
      },
      {
        id: "ds-02",
        name: "DS-02 DIY letters",
        kind: "non-agentic",
        trigger: "payment.received (not-qualified path)",
        timing: "immediate email",
        keys: ["EMAIL-DS02-DIY-LETTERS-READY"]
      },
      {
        id: "repair-notify",
        name: "Repair lane emails (src/repair/notify)",
        kind: "mixed",
        trigger: "repair lifecycle events",
        timing: "on event",
        keys: [
          "EMAIL-REPAIR-WELCOME",
          "EMAIL-REPAIR-LETTERS-SENT",
          "EMAIL-REPAIR-RESPONSE-RESULTS",
          "EMAIL-REPAIR-ROUND-ADVANCED",
          "EMAIL-REPAIR-RETAKE-PHOTO",
          "EMAIL-REPAIR-TRIAL-COMPLETE-UPSELL"
        ]
      },
      {
        id: "repair-bureau",
        name: "Repair bureau response reader",
        kind: "agentic",
        trigger: "docs.received",
        timing: "LLM reads letter → may notify",
        keys: [],
        promptRef: "BUREAU_RESPONSE_SYSTEM — see B-agent-prompts"
      },
      {
        id: "inquiry-sweeper",
        name: "Inquiry call sweeper",
        kind: "agentic-intent",
        trigger: "cron every 15m",
        timing: "queues bureau AI calls",
        keys: [],
        promptRef: "Experian/Equifax/TransUnion prompts — see B"
      }
    ]
  },
  {
    stage: "8. Funding rounds",
    beats: [
      {
        id: "round-started",
        name: "Round started client notify",
        kind: "non-agentic",
        trigger: "round.started",
        timing: "immediate SMS",
        keys: ["SMS-ROUND-STARTED-NOTIFY"]
      },
      {
        id: "f-01",
        name: "F-01 Funding intake",
        kind: "non-agentic",
        trigger: "round.started",
        timing: "pod assign — no client template",
        keys: []
      },
      {
        id: "f-02",
        name: "F-02 Portal/ID missing",
        kind: "non-agentic",
        trigger: "round.started",
        timing: "sleep 3h → email+SMS; sleep +2d → followup email",
        keys: [
          "EMAIL-F02-ID-PORTAL-NEEDED",
          "SMS-F02-ID-PORTAL-NEEDED",
          "EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP"
        ],
        notes: "OVERLAP RISK with round-started SMS at same event."
      },
      {
        id: "f-10",
        name: "F-10 Funding inbox provisioner",
        kind: "non-agentic",
        trigger: "round.started",
        timing: "immediate email+SMS when inbox ready",
        keys: ["EMAIL-F10-INBOX-SETUP", "SMS-F10-INBOX-SETUP"]
      },
      {
        id: "f-03",
        name: "F-03 Round submitted",
        kind: "non-agentic",
        trigger: "round.submitted",
        timing: "immediate",
        keys: ["EMAIL-F03-ROUND-SUBMITTED", "SMS-F03-ROUND-SUBMITTED"]
      },
      {
        id: "f-04",
        name: "F-04 Round approvals",
        kind: "non-agentic",
        trigger: "round.approved",
        timing: "immediate",
        keys: ["EMAIL-F04-ROUND-APPROVALS", "SMS-F04-ROUND-APPROVALS"]
      },
      {
        id: "f-06",
        name: "F-06 Missing docs",
        kind: "non-agentic",
        trigger: "mail.response / docs.received (+ inquiry-docs handler)",
        timing: "on missing-docs condition",
        keys: ["EMAIL-F06-MISSING-DOCS", "SMS-F06-MISSING-DOCS"]
      },
      {
        id: "f-07",
        name: "F-07 Funding locked",
        kind: "non-agentic",
        trigger: "round.funded",
        timing: "immediate",
        keys: ["EMAIL-F07-FUNDING-LOCKED", "SMS-F07-FUNDING-LOCKED"]
      },
      {
        id: "f-08",
        name: "F-08 Post-funding monitoring",
        kind: "non-agentic",
        trigger: "round.funded",
        timing: "30-day check-in TASK (not client template)",
        keys: []
      },
      {
        id: "f-09",
        name: "F-09 Funding declined / no path",
        kind: "non-agentic",
        trigger: "funding declined path",
        timing: "ops follow-through",
        keys: []
      },
      {
        id: "ax07",
        name: "AX-07 Funding paused (seeded keys)",
        kind: "non-agentic",
        trigger: "UNWIRED — keys in DB/seed, no workflow caller found",
        timing: "n/a",
        keys: ["EMAIL-AX07-FUNDING-PAUSED", "SMS-AX07-FUNDING-PAUSED"],
        notes: "ORPHAN-WIRED-KEYS: present in seed, no sendTemplated caller."
      }
    ]
  },
  {
    stage: "9. Post-funding nurture / renewal",
    beats: [
      {
        id: "n-04",
        name: "N-04 Post-funding nurture",
        kind: "non-agentic",
        trigger: "round.funded",
        timing: "immediate",
        keys: ["EMAIL-N04-POST-FUNDING", "SMS-N04-POST-FUNDING"]
      },
      {
        id: "n-06",
        name: "N-06 Renewal second wave",
        kind: "non-agentic",
        trigger: "round.funded",
        timing: "sleep 180d → email+SMS",
        keys: ["EMAIL-N06-RENEWAL", "SMS-N06-RENEWAL"]
      }
    ]
  },
  {
    stage: "10. System / dispatch (no client copy)",
    beats: [
      {
        id: "dispatch",
        name: "Message dispatch sweeper",
        kind: "non-agentic",
        trigger: "cron",
        timing: "drains queued messages → Resend / Twilio",
        keys: [],
        notes: "If this fails or outbound_enabled=false, everything looks like 'never sent'."
      },
      {
        id: "staff-mail",
        name: "Staff invite / password reset",
        kind: "non-agentic",
        trigger: "staff auth",
        timing: "Resend direct (not message_templates)",
        keys: [],
        notes: "INLINE in src/auth/staff-mail.mjs"
      },
      {
        id: "agents-runtime",
        name: "Inbound agent runtime",
        kind: "agentic",
        trigger: "message.inbound",
        timing: "selects registry agent → Claude → reply",
        keys: [],
        promptRef: "GHL agents in DB — see B"
      }
    ]
  }
];

function keysForPrefixes(prefixes) {
  if (!prefixes?.length) return [];
  return templates
    .filter((t) => prefixes.some((p) => t.key.startsWith(p)))
    .map((t) => t.key)
    .sort();
}

const wiredKeys = new Set();
for (const stage of JOURNEY) {
  for (const beat of stage.beats) {
    for (const k of beat.keys) wiredKeys.add(k);
    for (const k of keysForPrefixes(beat.keyPrefixes)) wiredKeys.add(k);
  }
}

// Alias resolution: workflow keys may map to doc keys in dump
const ALIASES = {
  "SMS-F02-ID-PORTAL-NEEDED": ["SMS-F02-01-PORTAL-ID", "SMS-F02-ID-PORTAL-NEEDED"],
  "SMS-F03-ROUND-SUBMITTED": ["SMS-F03-01-ROUND-SUBMITTED", "SMS-F03-ROUND-SUBMITTED"],
  "SMS-F04-ROUND-APPROVALS": ["SMS-F04-01-ROUND-MOVEMENT", "SMS-F04-ROUND-APPROVALS"],
  "SMS-F06-MISSING-DOCS": ["SMS-F06-01-MISSING-DOCS", "SMS-F06-MISSING-DOCS"],
  "SMS-F07-FUNDING-LOCKED": ["SMS-F07-01-LOC", "SMS-F07-FUNDING-LOCKED"],
  "SMS-F10-INBOX-SETUP": ["SMS-F10-01-INBOX-READY", "SMS-F10-INBOX-SETUP"],
  "SMS-AISET03-MSG1": ["SMS-AISET03-MSG1", "SMS-WF-AI-SET-03-NO-ANSWER-SMS-CADENCE-01"],
  "SMS-AISET03-MSG2": ["SMS-AISET03-MSG2", "SMS-WF-AI-SET-03-NO-ANSWER-SMS-CADENCE-02"],
  "SMS-AISET03-MSG3": ["SMS-AISET03-MSG3", "SMS-WF-AI-SET-03-NO-ANSWER-SMS-CADENCE-03"]
};

function resolveBody(key) {
  // Prefer the exact workflow key. Aliases are fallback only when the wired
  // key is missing from the live dump — never silently swap a different body.
  const exact = tpl(key);
  if (!exact.missing) return { ...exact, requestedKey: key, resolvedFrom: key };
  const candidates = ALIASES[key] || [];
  for (const c of candidates) {
    if (c === key) continue;
    const t = tpl(c);
    if (!t.missing) return { ...t, requestedKey: key, resolvedFrom: c };
  }
  return { ...exact, requestedKey: key, resolvedFrom: key };
}

function aliasConflictRows() {
  const rows = [];
  for (const [wiredKey, aliases] of Object.entries(ALIASES)) {
    const primary = tpl(wiredKey);
    if (primary.missing) continue;
    for (const altKey of aliases) {
      if (altKey === wiredKey) continue;
      const alt = tpl(altKey);
      if (alt.missing) continue;
      const bodyDiff = (alt.body || "").trim() !== (primary.body || "").trim();
      const complianceDiff = String(alt.compliance) !== String(primary.compliance);
      if (bodyDiff || complianceDiff) {
        rows.push({
          wiredKey,
          altKey,
          wiredCompliance: primary.compliance,
          altCompliance: alt.compliance,
          bodyDiff,
          complianceDiff,
          alt
        });
      }
    }
  }
  return rows;
}

/** Full BS email grid expected by product; live dump may be incomplete. */
function missingBsGridSlots() {
  const expected = [];
  for (const path of ["FUND", "REPAIR"]) {
    for (const day of [1, 2, 3]) {
      const slots = ["morning", "midmorning", "lunch", "afternoon", "evening", "night"];
      slots.forEach((slot, i) => {
        expected.push(`BS-${path}-D${day}-E${i + 1}-${slot}`);
      });
    }
  }
  return expected.filter((k) => !byKey.has(k));
}

function buildSpine() {
  let md = `# Fundhub Messaging Review

Generated: 2026-08-21  
Source: live message_templates dump (2026-08-20) + workflow code.

## How to mark decisions

For each beat, write one of:

- **KEEP** — timing and copy are right
- **CHANGE** — keep the beat, rewrite copy (edit the body below)
- **KILL** — stop sending this
- **WRONG-TIME** — copy OK, fire at a different step (note when)

Walk top to bottom once. Ignore other docs while you review.

Live dump: **237** templates (182 email, 55 SMS). compliance_passed true: **72**, false: **165**.  
Unapproved templates refuse to send — that alone can look like “wrong / missing timing.”

---

`;

  for (const stage of JOURNEY) {
    md += `# ${stage.stage}\n\n`;
    for (const beat of stage.beats) {
      md += `## ${beat.id} — ${beat.name}\n\n`;
      md += `- Kind: **${beat.kind}**\n`;
      md += `- Trigger: \`${beat.trigger}\`\n`;
      md += `- Timing: ${beat.timing}\n`;
      if (beat.notes) md += `- Note: ${beat.notes}\n`;
      if (beat.promptRef) md += `- Agent prompt: ${beat.promptRef}\n`;
      md += `\n**Beat decision:** ________\n\n`;

      const allKeys = [...beat.keys, ...keysForPrefixes(beat.keyPrefixes)];
      if (!allKeys.length) {
        md += `_No client template on this beat._\n\n`;
        continue;
      }
      for (const k of allKeys) {
        md += `### Template ${k}\n\n`;
        md += renderTpl(resolveBody(k));
        md += `\n`;
      }
    }
  }

  // Orphans — exclude alias duplicates (they get their own appendix)
  const aliasKeys = new Set();
  for (const [wk, al] of Object.entries(ALIASES)) {
    if (!wiredKeys.has(wk)) continue;
    for (const a of al) if (a !== wk) aliasKeys.add(a);
  }

  const orphan = templates.filter((t) => {
    if (wiredKeys.has(t.key)) return false;
    if (aliasKeys.has(t.key)) return false;
    // BS grid covered by prefix
    if (t.key.startsWith("BS-FUND-") || t.key.startsWith("BS-REPAIR-")) return false;
    return true;
  });

  const conflicts = aliasConflictRows();
  const missingBs = missingBsGridSlots();

  md += `# Appendix A — Orphan templates\n\n`;
  md += `Live rows with no journey beat wiring above (${orphan.length}). Review last (after journey-wired).\n\n`;
  for (const t of orphan.sort((a, b) => a.key.localeCompare(b.key))) {
    md += `## ${t.key}\n\n`;
    md += renderTpl(t);
    md += `\n`;
  }

  md += `# Appendix A2 — Duplicate live rows (aliases)\n\n`;
  md += `These live keys are **not** what workflows send. Workflows use the wired key above. `;
  md += `Each row below differs in body and/or compliance_passed from the wired key. `;
  md += `Mark **KILL** on the duplicate unless you intentionally want that old row kept for something else.\n\n`;
  md += `Conflicts found: **${conflicts.length}**.\n\n`;
  for (const row of conflicts) {
    md += `## ${row.altKey}\n\n`;
    md += `- Wired key workflows send: \`${row.wiredKey}\` (compliance_passed=${row.wiredCompliance})\n`;
    md += `- This duplicate: compliance_passed=${row.altCompliance}` +
      (row.bodyDiff ? `; body differs` : ``) +
      (row.complianceDiff ? `; compliance differs` : ``) +
      `\n\n`;
    md += renderTpl({ ...row.alt, requestedKey: row.altKey, resolvedFrom: row.altKey });
    md += `\n`;
  }

  md += `# Appendix A3 — Missing BS email grid slots\n\n`;
  md += `Product expects a 36-slot BS-FUND / BS-REPAIR D1–D3 × E1–E6 grid. `;
  md += `Live dump is missing **${missingBs.length}** slots (not reviewable until seeded):\n\n`;
  for (const k of missingBs) md += `- \`${k}\`\n`;
  md += `\n`;

  md += `# Appendix B — Timing findings (audit)\n\n`;
  md += `_Filled from C-timing-audit.md — see that file for full workflow map._\n\n`;
  md += `1. **Compliance gate:** 165/237 templates have compliance_passed=false → sendTemplated refuses → looks like “never came.”\n`;
  md += `2. **Booking SMS pile-up:** On booking.created, S-04B (confirm + T-24h + T-2h), BS-01 (BOOKED/PRECALL/DAYOF), AI-SET-04 (T-15), N-03 hot nurture, and BS-01 email grid can all run — high chance of “wrong time / too many texts.”\n`;
  md += `3. **Survey pile-up:** survey.submitted fires N-02 warm nurture AND S-NOBOOK chase (2h/24h/72h).\n`;
  md += `4. **Round start pile-up:** round.started fires round-started SMS, F-02 (3h), F-10 inbox — three tracks.\n`;
  md += `5. **Dispatch dependency:** All sends are queued until message-dispatch-sweeper + outbound_enabled + provider creds.\n`;
  md += `6. **AX-07** email/SMS seeded but no workflow caller found.\n`;
  md += `7. **Alias body trap (pack fix 2026-08-21):** 9 live duplicate SMS keys (e.g. SMS-F02-01-PORTAL-ID) had different copy + compliance_passed=false vs the wired keys workflows actually send. Earlier pack versions showed the wrong body. Fixed: wired key body first; duplicates in Appendix A2.\n`;
  md += `8. **Incomplete BS-REPAIR grid:** ${missingBs.length} expected BS slots absent from live dump (Appendix A3).\n`;

  return {
    md,
    orphanCount: orphan.length,
    wiredCount: wiredKeys.size,
    conflictCount: conflicts.length,
    missingBsCount: missingBs.length
  };
}

function buildAInventory() {
  let md = `# A — Copy pack inventory\n\n`;
  md += `Journey-wired keys collected from workflow map. Full bodies in journey-spine.md / Word doc.\n\n`;
  md += `| Stage | Beat | Keys |\n|---|---|---|\n`;
  for (const stage of JOURNEY) {
    for (const beat of stage.beats) {
      const keys = [...beat.keys, ...keysForPrefixes(beat.keyPrefixes)];
      md += `| ${stage.stage} | ${beat.id} | ${keys.join(", ") || "—"} |\n`;
    }
  }
  md += `\nWired key set size (approx): ${wiredKeys.size}\n`;
  md += `Live templates: ${templates.length}\n`;
  return md;
}

const { md, orphanCount, wiredCount } = buildSpine();
fs.writeFileSync(path.join(__dirname, "journey-spine.md"), md);
fs.writeFileSync(path.join(__dirname, "A-copy-inventory.md"), buildAInventory());
fs.writeFileSync(
  path.join(__dirname, "_journey-meta.json"),
  JSON.stringify({ orphanCount, wiredCount, stages: JOURNEY.length, templates: templates.length }, null, 2)
);
console.log("Wrote journey-spine.md, A-copy-inventory.md", { orphanCount, wiredCount, bytes: md.length });

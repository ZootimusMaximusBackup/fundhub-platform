# W13 — Agent Editor, all 22

Read-only. 2026-08-18. Live site `https://fundhub.ai/app/agent-editor.html` plus the live database.

No intended journey file names this screen. The claim we checked is Chris’s: **LIVE / “acting on real clients” means the agent can actually act.**

### Answer first: can the two LIVE agents act on a real person today?

**No.** They are a badge. They cannot text, call, or charge anyone today.

Setter Josh (`AG-04`) and Inquiry Removal AI (`AG-09`) are marked live, but the app will not pick them, and this site has no phone-dial path that uses them.

### Table of all 22

Status in the database: **2 live, 0 shadow, 12 draft, 8 retired.**

The screen says **2 LIVE · 0 SHADOW · 20 DRAFT**. That is wrong. The 8 old GoHighLevel agents are **retired** (owner canceled GoHighLevel on 2026-08-15). The screen paints retired as draft.

Trigger count on the screen = checkboxes inside the guardrail JSON. There is **no `agent_triggers` table** and **no `agent_runs` table**. Run count below is real: shadow-log rows + messages sent as that agent.

| Code | Name | Status | Meant to do | Prompt | Guardrails | Triggers (screen / old GHL) | Runs | Unsupervised powers |
|---|---|---|---|---|---|---|---|---|
| AG-04 | Setter Josh | live | Call leads on voice / Bland and book a meeting | n | n | 0 / 0 | 0 | None in use. Empty file. Cannot pay. Cannot discount. No message cap stored. |
| AG-09 | Inquiry Removal AI | live | Call credit bureaus on voice / Bland | n | n | 0 / 0 | 0 | Same as AG-04. None in use. |
| AG-01 | Agent 1 Lead Follow-up | draft | Sample SMS follow-up | n | y (empty words; cap 3) | 0 / 0 | 0 | Draft. Cannot run. File says message cap 3, no pay. |
| AG-02 | Agent 2 Billing | draft | Sample email billing | n | n | 0 / 0 | 0 | None. Draft. |
| AG-03 | Agent 3 Nurture | draft | Sample SMS nurture | n | n | 0 / 0 | 0 | None. Draft. |
| AG-05 | Agent 5 Onboarding | draft | Sample email onboarding | n | n | 0 / 0 | 0 | None. Draft. |
| AG-06 | Document Check | draft | Sample internal doc check | n | n | 0 / 0 | 0 | None. Draft. Internal. |
| AG-07 | Recon | draft | Sample internal watchdog | n | n | 0 / 0 | 0 | None. Draft. Internal. |
| AG-08 | Context Fetcher | draft | Sample internal memory | n | n | 0 / 0 | 0 | None. Draft. Internal. |
| OP-01 | Heartbeat | draft | Sample ops heartbeat | n | n | 0 / 0 | 0 | None. Draft. Ops. |
| OP-02 | Fixer | draft | Sample ops fixer | n | n | 0 / 0 | 0 | None. Draft. Ops. |
| OP-03 | Daily Brief | draft | Sample ops email brief | n | n | 0 / 0 | 0 | None. Draft. Ops. |
| OP-04 | Compliance Gate | draft | Sample ops gate | n | n | 0 / 0 | 0 | None. Draft. Ops. |
| OP-05 | Data + Models | draft | Sample ops models | n | n | 0 / 0 | 0 | None. Draft. Ops. |
| GHL-A1 | Agent 1 — Lead Follow-up & Booking | retired | Old GoHighLevel booking texts | y | y | 0 / 2 | 0 | Book yes. Pay no. Discount 0. Cap 8. Dead. |
| GHL-A2 | Agent 2 — AR / Collections | retired | Old GoHighLevel billing texts | y | y | 0 / 3 | 0 | Pay no. Cap 6. Dead. |
| GHL-A3 | Agent 3 — Non-Buyer & Nurture | retired | Old GoHighLevel nurture texts | y | y | 0 / 4 | 0 | Book yes. Pay no. Cap 6. Dead. |
| GHL-A4 | Agent 4 — Backend Pre-Call | retired | Old GoHighLevel pre-call replies | y | y | 0 / 2 | 0 | Book yes. Pay no. Cap 6. Dead. |
| GHL-A5 | Agent 5 — Onboarding & Doc-Chasing | retired | Old GoHighLevel doc chase | y | y | 0 / 3 | 0 | Pay no. Cap 8. Dead. |
| GHL-A7 | Agent 7 — Affiliate Re-engagement | retired | Old GoHighLevel affiliate nudge | y | y | 0 / 2 | 0 | Pay no. Cap 4. Dead. |
| GHL-DOC | Document Check | retired | Old GoHighLevel doc JSON check | y | n | 0 / 1 | 0 | Dead. Internal. |
| GHL-RECON | Recon | retired | Old GoHighLevel watchdog | y | n | 0 / 1 | 0 | Dead. Internal. Never a client. |

Who they ran on: **nobody.** Zero shadow-log rows. Zero messages with `sender_kind=agent`. Zero threads assigned. They have never sent a body.

### What happens if AG-04 / AG-09 fire now

They do not fire. If the system tries, here is the door-by-door result.

**A text or email comes in**

1. The reply robot only wakes on `message.inbound`.
2. That event has **never** been written. Count today: **0**.
3. Even if a text landed, the picker (`src/agents/select.mjs`) would skip both LIVE rows. Three separate locks, any one is enough:
   - runtime is `bland` → Bland and GoHighLevel are rejected
   - channel is `voice` → this robot only answers sms or email
   - prompt is empty → empty prompt cannot be picked
4. Result: `{ reason: "no_eligible_agent" }`. No reply. No shadow log. Nothing leaves.

**Someone tries to make them “act on Voice”**

1. This repo has **no Bland dialer**. Nothing in `src/` calls Bland’s phone API.
2. The Bland adapter only **receives** a finished-call webhook. It does not start a call.
3. The phone proxy `/api/inquiry` needs `INQUIRY_API_BASE`. That name is **unset**. The route answers “not configured” and does not call out.
4. The old inquiry-removal code under `vendor/` is **not** deployed on fundhub.ai.
5. Inquiry cases in the database: **3**. Calls actually fired: **0**.
6. Outbound call rows: **0**.

**If we pretend the picker was broken and they ran with no prompt**

The model key **is** set. Outbound mail/text **is** on. A live messaging agent with a real prompt could send. These two still would not, because the picker never hands them the job. They also have no payment button. The robot can only queue a text or email. It cannot charge a card.

**The one Bland event we do have**

One `call.completed` on 2026-08-15. Source `bland`. No client id. Not tagged to AG-04 or AG-09. That was a prove ping, not these agents working a file.

### Actual risk today (plain)

**These two LIVE rows cannot text, call, or charge a real person today.**

They are a green badge that tells a lie. The page says “acting on real clients on Voice. 0 runs.” The promotion box on the same page says they should not even be allowed to go live (no trigger, no prompt, no guardrail). They were seeded live on purpose in July. They were never promoted through that gate.

What is real, and what is not:

- **Not a risk today:** Josh or Inquiry Removal AI talking to a client from this CRM.
- **Not a risk today:** them taking a payment. There is no pay path on an agent.
- **The lie is the risk:** a human will trust the LIVE tile and think a robot is covering the desk.
- **A later risk, not these two:** the model key is on, and outbound is on. If someone later writes a prompt and flips a **messaging** agent to live with runtime that is not Bland/GoHighLevel, that one could text. None of the 22 can do that right now.
- **Outside this repo:** the old Vercel inquiry app is not proven here. This site does not call it. W6 already showed Send never left for that host.

W5 found the empty live badge (BROKEN #21). Deeper than W5:

1. The picker has three hard stops, not one.
2. The only real wake-up is inbound text/email, and that event has never happened.
3. There is no phone send path on this site for these rows.
4. Eight GoHighLevel agents are retired in the database but shown as draft, each with a real old prompt the screen treats like a working draft.
5. Screen trigger checkboxes are not what wakes the robot. The robot does not read them.

### Evidence paths

- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13/REPORT.md`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13/agents.json`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13/probe.json`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13/follow.json`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13/screen.json`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13/screen-ag09.json`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13/01-list-two-live.png`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13/02-ag-04-setter-josh.png`
- `docs/workflows/audit-crm-whole-2026-08-18-evidence/w13/03-ag-09-inquiry-removal.png`

Code that proves the locks: `src/agents/select.mjs`, `src/agents/runtime.mjs`, `api/inquiry.mjs`, `src/adapters/bland.mjs` (webhook only), `db/migrations/037_agent_registry.sql` (seeded live empty), `db/migrations/168_retire_ghl_agents.sql`.

### Stop line

W13 stop. Two LIVE badges. Zero actions. Findings only. Chris names what to fix.

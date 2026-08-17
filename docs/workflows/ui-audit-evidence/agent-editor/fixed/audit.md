# UI audit evidence — agent-editor/fixed as owner@fundhub.ai

Ran 2026-08-17T10:31:35.377Z against https://fundhub.ai. Login ok (role owner). Screen /app/agent-editor.html → HTTP 200, final /app/agent-editor.html, title "Fundhub — Agent Editor".

Shots: docs/workflows/ui-audit-evidence/agent-editor/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/agent-editor/fixed/1440-full.png · docs/workflows/ui-audit-evidence/agent-editor/fixed/390-full.png

## Load
- API calls: 7; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 1932px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Agent Editor · H2s: —
- Nav: 4 visible items · active: ◈Agent EditorBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(4), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (7): 28px×4, 18px×2, 14px×44, 13px×1, 12px×1, 11px×153, 10px×1
- Primary-looking (filled) buttons: 3 — "+ New agent", "Save agent", "Chat"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 14px×10, 13px×7, 6px×1, 7px×3
- Uneven card rows: top 120: [956,230,230,230,230]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: payment.failed
- Empty-state wording: Guardrail block is not empty | no source yet · not blocking
- Tables: none
- Metric-ish elements: "AE-00 / AGENTS2217 client-faci"@14px, "AE-00 / AGENTS2217 client-faci"@14px, "AE-00 / LIVE2acting on real cl"@14px, "AE-00 / SHADOW0logging, not se"@14px, "AE-00 / BREACHES 7D0guardrail "@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 4 · api fails: 0

## Click sweep
- 55 clicked of 55 candidates (cap 80) · tally: OK=33, WRITE-INTERCEPTED=2, DIALOG=1, NOOP=16, GONE=3

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "+ New agent" | 112×35 | WRITE-INTERCEPTED | POST /api/agents 599 · WRITE POST /api/agents {action,name,channel,agent_class} · dialog: alert "Could not create agent: UI audit harness refused to send this write" · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/02-WRITE-INTERCEPTED-_New_agent.png |
| 3 | button "Return to shadow" | 150×35 | DIALOG | dialog: confirm "Return Setter Josh to shadow?

It stops acting on real clients over Voice immediately. From then on it only logs what it would have sent — nothing leaves the building." |  |
| 4 | summary "AE-01 / IDENTITY" | 644×42 | OK |  |  |
| 5 | summary "AE-02 / TRIGGER EVENTS 0 SELECTED" | 644×42 | OK |  |  |
| 6 | button "✓entry.captured" | 302×33 | OK |  |  |
| 7 | button "✓survey.submitted" | 302×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/07-NOOP-_survey_submitted.png |
| 8 | button "✓payment.received" | 302×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/08-NOOP-_payment_received.png |
| 9 | button "✓payment.failed" | 302×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/09-NOOP-_payment_failed.png |
| 10 | button "✓diagnostic.paid" | 302×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/10-NOOP-_diagnostic_paid.png |
| 11 | button "✓deposit.paid" | 302×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/11-NOOP-_deposit_paid.png |
| 12 | button "✓sale.closed" | 302×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/12-NOOP-_sale_closed.png |
| 13 | button "✓analysis.completed" | 302×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/13-NOOP-_analysis_completed.png |
| 14 | button "✓decision.rendered" | 302×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/14-NOOP-_decision_rendered.png |
| 15 | button "✓message.inbound" | 302×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/15-NOOP-_message_inbound.png |
| 16 | button "✓call.completed" | 302×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/16-NOOP-_call_completed.png |
| 17 | button "✓mail.response" | 302×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/17-NOOP-_mail_response.png |
| 18 | button "✓booking.created" | 302×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/18-NOOP-_booking_created.png |
| 19 | summary "AE-03 / PROMPT 0 CHARS" | 644×42 | OK |  |  |
| 20 | summary "AE-05 / ESCALATION PATH" | 644×42 | OK |  |  |
| 21 | summary "AE-08 / SHADOW LOG WHAT IT WOULD HAVE SENT" | 644×42 | OK |  |  |
| 22 | button "Save agent" | 105×35 | WRITE-INTERCEPTED | POST /api/agents 599 · WRITE POST /api/agents {action,code,name,channel,agent_class,owner_label,prompt,guardrails} · dialog: alert "Could not save: UI audit harness refused to send this write" · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/22-WRITE-INTERCEPTED-Save_agent.png |
| 23 | button "Revert" | 75×35 | OK | GET /api/read/agent-shadow-log 200 |  |
| 24 | button "Search⌘K" | 99×36 | OK |  |  |
| 25 | button "Chat" | 52×52 | OK |  |  |
| 26 | div "Setter Joshliveno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 27 | div "Inquiry Removal AIliveno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 28 | div "Agent 1 Lead Follow-updraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 29 | div "Agent 2 Billingdraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 30 | div "Agent 3 Nurturedraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 31 | div "Agent 5 Onboardingdraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 32 | div "Document Checkdraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 33 | div "Recondraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 34 | div "Context Fetcherdraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 35 | div "Agent 1 — Lead Follow-up & Bookingdraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 36 | div "Agent 2 — AR / Collectionsdraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 37 | div "Agent 3 — Non-Buyer & Nurturedraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 38 | div "Agent 4 — Backend Pre-Call (replies only)draftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 39 | div "Agent 5 — Onboarding & Doc-Chasingdraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 40 | div "Agent 7 — Affiliate Re-engagementdraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 41 | div "Document Checkdraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 42 | div "Recondraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 43 | div "Heartbeatdraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 44 | div "Fixerdraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 45 | div "Daily Briefdraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 46 | div "Compliance Gatedraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 47 | div "Data + Modelsdraftno trig" | 294×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 48 | div "g_noamount" | 38×21 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 49 | div "g_noscore" | 38×21 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 50 | div "g_attorney" | 38×21 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 51 | div "g_quiet" | 38×21 | OK |  |  |
| 52 | div "l_pay" | 38×21 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/52-NOOP-l_pay.png |
| 53 | div "l_contract" | 38×21 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/53-NOOP-l_contract.png |
| 54 | div "l_book" | 38×21 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/54-NOOP-l_book.png |
| 55 | div "l_pull" | 38×21 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/fixed/clicks/55-NOOP-l_pull.png |

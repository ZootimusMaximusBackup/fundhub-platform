# UI audit evidence — T13-before-agent-editor as owner@fundhub.ai

Ran 2026-08-19T06:50:44.821Z against https://fundhub.ai. Login ok (role owner). Screen /app/agent-editor.html → HTTP 200, final /app/agent-editor.html, title "Fundhub — Agent Editor".

Shots: docs/workflows/ui-audit-evidence/T13-before-agent-editor/1440-fold.png · docs/workflows/ui-audit-evidence/T13-before-agent-editor/1440-full.png · docs/workflows/ui-audit-evidence/T13-before-agent-editor/390-full.png

## Load
- API calls: 6; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 2133px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Agent Editor · H2s: —
- Nav: 4 visible items · active: ◈Agent EditorBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(4), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (5): 32px×4, 20px×1, 16px×147, 13px×40, 11px×1
- Primary-looking (filled) buttons: 2 — "Save agent", "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 14px×10, 13px×7, 6px×1, 7px×3
- Uneven card rows: top 144: [1164,282,282,282,282]
- ALL-CAPS runs: 7 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: payment.failed
- Empty-state wording: Guardrail block is not empty | no source yet · not blocking
- Tables: none
- Metric-ish elements: "AGENTS2217 client-facing · 5 o"@16px, "AGENTS2217 client-facing · 5 o"@16px, "LIVE2acting on real clients"@16px, "SHADOW0logging, not sending"@16px, "BREACHES 7D0guardrail blocks"@16px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 0 · api fails: 0

## Click sweep
- 55 clicked of 55 candidates (cap 80) · tally: OK=31, DIALOG=2, NOOP=17, WRITE-INTERCEPTED=1, GONE=4

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 85×40 | OK |  |  |
| 2 | button "+ New agent" | 74×77 | DIALOG | dialog: prompt "Name this agent" |  |
| 3 | button "Search⌘K" | 120×42 | OK |  |  |
| 4 | button "Return to shadow" | 171×40 | DIALOG | dialog: confirm "Return Setter Josh to shadow?

It stops acting on real clients over Voice immediately. From then on it only logs what it would have sent — nothing leaves the building." |  |
| 5 | summary "IDENTITY" | 852×45 | OK |  |  |
| 6 | summary "TRIGGER EVENTS 0 SELECTED" | 852×45 | OK |  |  |
| 7 | button "✓entry.captured" | 269×40 | OK |  |  |
| 8 | button "✓survey.submitted" | 269×40 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/08-NOOP-_survey_submitted.png |
| 9 | button "✓payment.received" | 269×40 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/09-NOOP-_payment_received.png |
| 10 | button "✓payment.failed" | 269×40 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/10-NOOP-_payment_failed.png |
| 11 | button "✓diagnostic.paid" | 269×40 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/11-NOOP-_diagnostic_paid.png |
| 12 | button "✓deposit.paid" | 269×40 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/12-NOOP-_deposit_paid.png |
| 13 | button "✓sale.closed" | 269×40 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/13-NOOP-_sale_closed.png |
| 14 | button "✓analysis.completed" | 269×40 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/14-NOOP-_analysis_completed.png |
| 15 | button "✓decision.rendered" | 269×40 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/15-NOOP-_decision_rendered.png |
| 16 | button "✓message.inbound" | 269×40 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/16-NOOP-_message_inbound.png |
| 17 | button "✓call.completed" | 269×40 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/17-NOOP-_call_completed.png |
| 18 | button "✓mail.response" | 269×40 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/18-NOOP-_mail_response.png |
| 19 | button "✓booking.created" | 269×40 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/19-NOOP-_booking_created.png |
| 20 | summary "PROMPT 0 CHARS" | 852×45 | OK |  |  |
| 21 | summary "ESCALATION PATH" | 852×45 | OK |  |  |
| 22 | summary "SHADOW LOG WHAT IT WOULD HAVE SENT" | 852×45 | OK |  |  |
| 23 | button "Save agent" | 118×40 | WRITE-INTERCEPTED | POST /api/agents 599 · WRITE POST /api/agents {action,code,name,channel,agent_class,owner_label,prompt,guardrails} · dialog: alert "Could not save: UI audit harness refused to send this write" · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/23-WRITE-INTERCEPTED-Save_agent.png |
| 24 | button "Revert" | 83×40 | OK | GET /api/read/agent-shadow-log 200 |  |
| 25 | button "Chat" | 52×52 | OK |  |  |
| 26 | div "Setter Joshliveno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 27 | div "Inquiry Removal AIliveno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 28 | div "Agent 1 Lead Follow-updraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 29 | div "Agent 2 Billingdraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 30 | div "Agent 3 Nurturedraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 31 | div "Agent 5 Onboardingdraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 32 | div "Document Checkdraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 33 | div "Recondraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 34 | div "Context Fetcherdraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 35 | div "Agent 1 — Lead Follow-up & Bookingdraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 36 | div "Agent 2 — AR / Collectionsdraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 37 | div "Agent 3 — Non-Buyer & Nurturedraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 38 | div "Agent 4 — Backend Pre-Call (replies only)draftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 39 | div "Agent 5 — Onboarding & Doc-Chasingdraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 40 | div "Agent 7 — Affiliate Re-engagementdraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 41 | div "Document Checkdraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 42 | div "Recondraftno trig" | 294×47 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/42-NOOP-Recondraftno_trig.png |
| 43 | div "Heartbeatdraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200; GET /api/read/agent-shadow-log 200 |  |
| 44 | div "Fixerdraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 45 | div "Daily Briefdraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 46 | div "Compliance Gatedraftno trig" | 294×47 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/46-NOOP-Compliance_Gatedraftno_trig.png |
| 47 | div "Data + Modelsdraftno trig" | 294×47 | OK | GET /api/read/agent-shadow-log 200 |  |
| 48 | div "g_noamount" | 38×21 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 49 | div "g_noscore" | 38×21 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 50 | div "g_attorney" | 38×21 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 51 | div "g_quiet" | 38×21 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 52 | div "l_pay" | 38×21 | OK |  |  |
| 53 | div "l_contract" | 38×21 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/53-NOOP-l_contract.png |
| 54 | div "l_book" | 38×21 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/54-NOOP-l_book.png |
| 55 | div "l_pull" | 38×21 | NOOP |  | docs/workflows/ui-audit-evidence/T13-before-agent-editor/clicks/55-NOOP-l_pull.png |

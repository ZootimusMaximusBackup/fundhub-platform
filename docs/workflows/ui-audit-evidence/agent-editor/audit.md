# UI audit evidence — agent-editor as owner@fundhub.ai

Ran 2026-08-17T06:31:12.347Z against https://fundhub.ai. Login ok (role owner). Screen /app/agent-editor.html → HTTP 200, final /app/agent-editor.html, title "Fundhub — Agent Editor".

Shots: docs/workflows/ui-audit-evidence/agent-editor/1440-fold.png · docs/workflows/ui-audit-evidence/agent-editor/1440-full.png · docs/workflows/ui-audit-evidence/agent-editor/390-full.png

## Load
- API calls: 7; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 1885px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Agent Editor · H2s: —
- Nav: 33 visible items · active: ◈Agent EditorBETA · groups: Sales▾(6), Funding▾(4), Client ops▾(5), Watch▾(3), Automation▾(4), Marketing▾(4), Admin▾(5), Portals▾(2)
- Font sizes in use (13): 22px×4, 17px×1, 14.5px×1, 13px×2, 12.5px×30, 12px×14, 11.5px×29, 11px×41, 10.5px×1, 10px×29, 9.5px×27, 9px×1, 8.5px×22
- Primary-looking (filled) buttons: 3 — "+ New agent", "Save agent", "Chat"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 14px×10, 13px×7, 6px×1, 7px×3
- Uneven card rows: top 120: [1164,282,282,282,282]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: payment.failed
- Empty-state wording: Guardrail block is not empty | no source yet · not blocking
- Tables: none
- Metric-ish elements: "AE-00 / AGENTS2217 client-faci"@13px, "AE-00 / AGENTS2217 client-faci"@13px, "AE-00 / LIVE2acting on real cl"@13px, "AE-00 / SHADOW0logging, not se"@13px, "AE-00 / BREACHES 7D0guardrail "@13px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 108 · api fails: 0

## Click sweep
- 55 clicked of 55 candidates (cap 80) · tally: OK=33, WRITE-INTERCEPTED=3, NOOP=17, GONE=2

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "+ New agent" | 112×35 | WRITE-INTERCEPTED | POST /api/agents 599 · WRITE POST /api/agents {action,name,channel,agent_class} · dialog: alert "Could not create agent: UI audit harness refused to send this write" · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/agent-editor/clicks/02-WRITE-INTERCEPTED-_New_agent.png |
| 3 | button "Return to shadow" | 150×35 | WRITE-INTERCEPTED | POST /api/agents 599 · WRITE POST /api/agents {action,code} · dialog: alert "Could not demote: UI audit harness refused to send this write" · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/agent-editor/clicks/03-WRITE-INTERCEPTED-Return_to_shadow.png |
| 4 | summary "AE-01 / IDENTITY" | 852×42 | OK |  |  |
| 5 | summary "AE-02 / TRIGGER EVENTS 0 SELECTED" | 852×42 | OK |  |  |
| 6 | button "✓entry.captured" | 269×33 | OK |  |  |
| 7 | button "✓survey.submitted" | 269×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/07-NOOP-_survey_submitted.png |
| 8 | button "✓payment.received" | 269×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/08-NOOP-_payment_received.png |
| 9 | button "✓payment.failed" | 269×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/09-NOOP-_payment_failed.png |
| 10 | button "✓diagnostic.paid" | 269×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/10-NOOP-_diagnostic_paid.png |
| 11 | button "✓deposit.paid" | 269×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/11-NOOP-_deposit_paid.png |
| 12 | button "✓sale.closed" | 269×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/12-NOOP-_sale_closed.png |
| 13 | button "✓analysis.completed" | 269×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/13-NOOP-_analysis_completed.png |
| 14 | button "✓decision.rendered" | 269×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/14-NOOP-_decision_rendered.png |
| 15 | button "✓message.inbound" | 269×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/15-NOOP-_message_inbound.png |
| 16 | button "✓call.completed" | 269×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/16-NOOP-_call_completed.png |
| 17 | button "✓mail.response" | 269×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/17-NOOP-_mail_response.png |
| 18 | button "✓booking.created" | 269×33 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/18-NOOP-_booking_created.png |
| 19 | summary "AE-03 / PROMPT 0 CHARS" | 852×42 | OK |  |  |
| 20 | summary "AE-05 / ESCALATION PATH" | 852×42 | OK |  |  |
| 21 | summary "AE-08 / SHADOW LOG WHAT IT WOULD HAVE SENT" | 852×42 | OK |  |  |
| 22 | button "Save agent" | 105×35 | WRITE-INTERCEPTED | POST /api/agents 599 · WRITE POST /api/agents {action,code,name,channel,agent_class,owner_label,prompt,guardrails} · dialog: alert "Could not save: UI audit harness refused to send this write" · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/agent-editor/clicks/22-WRITE-INTERCEPTED-Save_agent.png |
| 23 | button "Revert" | 75×35 | OK | GET /api/read/agent-shadow-log 200 |  |
| 24 | button "Search⌘K" | 99×36 | OK |  |  |
| 25 | button "Chat" | 52×52 | OK |  |  |
| 26 | div "Setter Joshliveno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 27 | div "Inquiry Removal AIliveno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 28 | div "Agent 1 Lead Follow-updraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 29 | div "Agent 2 Billingdraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 30 | div "Agent 3 Nurturedraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 31 | div "Agent 5 Onboardingdraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 32 | div "Document Checkdraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 33 | div "Recondraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 34 | div "Context Fetcherdraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 35 | div "Agent 1 — Lead Follow-up & Bookingdraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 36 | div "Agent 2 — AR / Collectionsdraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 37 | div "Agent 3 — Non-Buyer & Nurturedraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 38 | div "Agent 4 — Backend Pre-Call (replies only)draftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 39 | div "Agent 5 — Onboarding & Doc-Chasingdraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 40 | div "Agent 7 — Affiliate Re-engagementdraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 41 | div "Document Checkdraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 42 | div "Recondraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 43 | div "Heartbeatdraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 44 | div "Fixerdraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 45 | div "Daily Briefdraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 46 | div "Compliance Gatedraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 47 | div "Data + Modelsdraftno trig" | 294×38 | OK | GET /api/read/agent-shadow-log 200 |  |
| 48 | div "g_noamount" | 38×21 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 49 | div "g_noscore" | 38×21 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 50 | div "g_attorney" | 38×21 | OK |  |  |
| 51 | div "g_quiet" | 38×21 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/51-NOOP-g_quiet.png |
| 52 | div "l_pay" | 38×21 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/52-NOOP-l_pay.png |
| 53 | div "l_contract" | 38×21 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/53-NOOP-l_contract.png |
| 54 | div "l_book" | 38×21 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/54-NOOP-l_book.png |
| 55 | div "l_pull" | 38×21 | NOOP |  | docs/workflows/ui-audit-evidence/agent-editor/clicks/55-NOOP-l_pull.png |

# UI audit evidence — brand-studio/fixed as partner@fundhub.ai

Ran 2026-08-17T10:40:30.743Z against https://fundhub.ai. Login ok (role partner). Screen /app/brand-studio.html → HTTP 200, final /app/brand-studio.html, title "Fundhub — Brand Studio".

Shots: docs/workflows/ui-audit-evidence/brand-studio/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/brand-studio/fixed/1440-full.png · docs/workflows/ui-audit-evidence/brand-studio/fixed/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 2550px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Brand Studio · H2s: —
- Nav: 1 visible items · active: ◆Brand StudioBETA · groups: Admin▾(1)
- Font sizes in use (4): 28px×6, 18px×2, 14px×27, 11px×82
- Primary-looking (filled) buttons: 2 — "Create pages from selected funnels", "Save & apply"
- Generic labels: none · targets under 40px: 8
- Off-8px-scale spacing values: 14px×9, 13px×7, 6px×3, 10px×1, 9px×4
- Uneven card rows: top 120: [1164,282,282,282,282]; top 232: [1164,728,420]; top 632: [348,170,170]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | Coming soon
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "BS-00 / BRANDText markwordmark"@14px, "BS-00 / BRANDText markwordmark"@14px, "BS-00 / DOMAIN—not connected"@14px, "BS-00 / FUNNELS LIVE0of 6 avai"@14px, "BS-00 / COMPLIANCELockedmaster"@14px, "8 values, everything renders f"@11px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: input#bLogo · text under 11px: 3 · api fails: 0

## Click sweep
- 15 clicked of 15 candidates (cap 80) · tally: OK=9, DIALOG=1, NOOP=4, WRITE-INTERCEPTED=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "Reset" | 67×35 | DIALOG | dialog: confirm "Discard unsaved brand changes in this browser?

Your saved brand is not changed — this only clears edits that were never written to the server." |  |
| 3 | button "Presets" | 82×35 | NOOP |  | docs/workflows/ui-audit-evidence/brand-studio/fixed/clicks/03-NOOP-Presets.png |
| 4 | button "Create pages from selected funnels" | 284×35 | OK |  |  |
| 5 | button "Save & apply" | 116×39 | WRITE-INTERCEPTED | PUT /api/partner-brand 599 · WRITE PUT /api/partner-brand {partner_id,ink,paper,ramp,display_face,mono_face,voice,entity_name,support_email,domain,selected_funnels,wordmark_url} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/brand-studio/fixed/clicks/05-WRITE-INTERCEPTED-Save_apply.png |
| 6 | button "Submit for approval" | 172×35 | OK |  |  |
| 7 | div "Application funnelHero, process, engine, options, guarantees" | 226×115 | OK |  |  |
| 8 | div "Diagnostic funnelStraight to the assessment offer. Lowest fr" | 226×115 | OK |  |  |
| 9 | div "Education funnelTwo-program structure with curriculum and en" | 226×115 | OK |  |  |
| 10 | div "Affiliate recruitTwo-track partner page. Recruits under your" | 226×94 | OK |  |  |
| 11 | div "Direct-mail landingPURL/QR destination matched to the mail p" | 226×94 | OK |  |  |
| 12 | div "Booking funnelStraight to calendar. For warm and referral tr" | 226×94 | OK |  |  |
| 13 | div "Generate VSL scriptBuilt from your offer and the proven cont" | 226×115 | NOOP |  | docs/workflows/ui-audit-evidence/brand-studio/fixed/clicks/13-NOOP-Generate_VSL_scriptBuilt_from_.png |
| 14 | div "Generate ad scriptsHooks, angles, and creative variants from" | 226×115 | NOOP |  | docs/workflows/ui-audit-evidence/brand-studio/fixed/clicks/14-NOOP-Generate_ad_scriptsHooks_angle.png |
| 15 | div "Generate wordmarkTypographic lockups rendered in your displa" | 226×115 | NOOP |  | docs/workflows/ui-audit-evidence/brand-studio/fixed/clicks/15-NOOP-Generate_wordmarkTypographic_l.png |

# UI audit evidence — brand-studio as partner@fundhub.ai

Ran 2026-08-17T06:08:49.281Z against https://fundhub.ai. Login ok (role partner). Screen /app/brand-studio.html → HTTP 200, final /app/brand-studio.html, title "Fundhub — Brand Studio".

Shots: docs/workflows/ui-audit-evidence/brand-studio/1440-fold.png · docs/workflows/ui-audit-evidence/brand-studio/1440-full.png · docs/workflows/ui-audit-evidence/brand-studio/390-full.png

## Load
- API calls: 5; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 2472px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Brand Studio · H2s: —
- Nav: 1 visible items · active: ◆Brand StudioBETA · groups: Admin▾(1)
- Font sizes in use (14): 24px×2, 22px×4, 19px×1, 14.5px×1, 13px×8, 12.5px×10, 12px×17, 11.5px×25, 11px×36, 10.5px×5, 10px×2, 9.5px×1, 9px×5, 8.5px×2
- Primary-looking (filled) buttons: 3 — "Verify", "Create pages from selected funnels", "Save & apply"
- Generic labels: none · targets under 40px: 9
- Off-8px-scale spacing values: 14px×9, 13px×7, 6px×3, 10px×1, 9px×4
- Uneven card rows: top 120: [1164,282,282,282,282]; top 224: [1164,728,420]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | Coming soon
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "BS-00 / BRANDText markwordmark"@13px, "BS-00 / BRANDText markwordmark"@13px, "BS-00 / DOMAIN—not connected"@13px, "BS-00 / FUNNELS LIVE0of 6 avai"@13px, "BS-00 / COMPLIANCELockedmaster"@13px, "8 values, everything renders f"@10.5px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: input#bLogo · text under 11px: 20 · api fails: 0

## Click sweep
- 17 clicked of 17 candidates (cap 80) · tally: OK=9, DIALOG=1, NOOP=6, WRITE-INTERCEPTED=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "Reset" | 67×35 | DIALOG | dialog: confirm "Reset brand to fundhub defaults?" |  |
| 3 | button "Use text" | 90×35 | NOOP |  | docs/workflows/ui-audit-evidence/brand-studio/clicks/03-NOOP-Use_text.png |
| 4 | button "Presets" | 82×35 | NOOP |  | docs/workflows/ui-audit-evidence/brand-studio/clicks/04-NOOP-Presets.png |
| 5 | button "Verify" | 75×35 | OK |  |  |
| 6 | button "Create pages from selected funnels" | 284×35 | OK |  |  |
| 7 | button "Save & apply" | 107×37 | WRITE-INTERCEPTED | PUT /api/partner-brand 599 · WRITE PUT /api/partner-brand {partner_id,ink,paper,ramp,display_face,mono_face,voice,entity_name,support_email,domain,selected_funnels,wordmark_url} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/brand-studio/clicks/07-WRITE-INTERCEPTED-Save_apply.png |
| 8 | button "Submit for approval" | 172×35 | OK |  |  |
| 9 | div "✓Application funnelHero, process, engine, options, guarantee" | 226×108 | NOOP |  | docs/workflows/ui-audit-evidence/brand-studio/clicks/09-NOOP-_Application_funnelHero_proces.png |
| 10 | div "Diagnostic funnelStraight to the assessment offer. Lowest fr" | 226×108 | OK |  |  |
| 11 | div "Education funnelTwo-program structure with curriculum and en" | 226×108 | OK |  |  |
| 12 | div "Affiliate recruitTwo-track partner page. Recruits under your" | 226×89 | OK |  |  |
| 13 | div "Direct-mail landingPURL/QR destination matched to the mail p" | 226×89 | OK |  |  |
| 14 | div "Booking funnelStraight to calendar. For warm and referral tr" | 226×89 | OK |  |  |
| 15 | div "Generate VSL scriptBuilt from your offer and the proven cont" | 226×108 | NOOP |  | docs/workflows/ui-audit-evidence/brand-studio/clicks/15-NOOP-Generate_VSL_scriptBuilt_from_.png |
| 16 | div "Generate ad scriptsHooks, angles, and creative variants from" | 226×108 | NOOP |  | docs/workflows/ui-audit-evidence/brand-studio/clicks/16-NOOP-Generate_ad_scriptsHooks_angle.png |
| 17 | div "Generate wordmarkTypographic lockups rendered in your displa" | 226×108 | NOOP |  | docs/workflows/ui-audit-evidence/brand-studio/clicks/17-NOOP-Generate_wordmarkTypographic_l.png |

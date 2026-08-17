# PATTERN MEDIUM restamp — 2026-08-17

Live samples + today’s HIGH-pass restamp folds. No board edit.

## §3 font-size sprawl — STILL-OPEN

Visible non-sidebar text, 1440×900:

| Screen | Distinct sizes | Sizes (px) | Evidence |
|---|---|---|---|
| pipeline (closer) | 6 | 18 / 14 / 13 / 12 / 11 / 10 | restamp/font-layout.json |
| command-center (owner) | 8 | 28 / 18 / 16 / 14 / 13 / 12 / 11 / 10 | ../command-center/restamp/font-layout.json |
| brand-studio (partner) | 4 | 28 / 18 / 14 / 11 | ../brand-studio/restamp/font-layout.json |

Typical shell still > 4 (pipeline 6, command-center 8). Down from the original 7–18 range, but not to ≤4. brand-studio hits the cap of 4.

## §1 max content width 1280 — CONFIRMED-FIXED

`.fh-maxw` is live with computed `max-width: 1280px`:

- pipeline `.shell.fh-maxw` → 1280px / painted 1212px
- command-center `main.fh-maxw` → 1280px / painted 1212px
- brand-studio `.content.fh-maxw` → 1280px / painted 1212px
- campaign-manager `.content.fh-maxw` → 1280px / painted 1280px (cap bites)

At 1440 the sidebar already leaves ~1212px, so the cap is often invisible. The class is applied; campaign-manager paints at the 1280 cap.

## §7 metrics with no comparison — STILL-OPEN

No “vs yesterday / vs target” on live body text (`comparisonHits: []`):

- pipeline restamp/1440-fold.png — “$50,000 est. — held”, column “$0 est.”, no comparison
- command-center restamp/1440-fold.png — KPI tiles are bare counts / $0 with definitional captions
- products-commissions restamp/1440-fold.png — 5 / 0 / $0 / $0 with captions, no vs-target

## §2 off-8px / 5-column tiles — STILL-OPEN

From today’s restamp folds + live layout probe:

- campaign-manager `.stats` = 5 children at 237px; card padding 14px (`font-layout.json`; `1440-fold.png`)
- social-studio `.stats` = 5 children at 223px; card padding 14px (`../social-studio/restamp/font-layout.json`; `../social-studio/restamp/1440-fold.png`)
- products-commissions / brand-studio stats still use 14px padding (on-8 would be 8/16)

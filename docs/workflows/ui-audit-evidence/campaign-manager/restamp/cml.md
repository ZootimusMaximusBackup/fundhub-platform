# campaign-manager C/M/L restamp — 2026-08-17 live

Live: https://fundhub.ai/app/campaign-manager.html as owner@fundhub.ai
Shots: 1440-fold.png, 1440-full.png, 390-fold.png, probe.json, font-layout.json

| LINE | Sev | Verdict | Evidence | Live |
|---|---|---|---|---|
| 467 | CRITICAL | CONFIRMED-FIXED | 1440-fold.png, 1440-full.png, probe.json | No Ironwood, no $964.30. Tiles are dashes. Tables say nothing can be shown until a partner is chosen. Reads still 400. |
| 468 | CRITICAL | CONFIRMED-FIXED | 1440-fold.png | No red "1 CEILING BREACHED" pill. Header is Campaigns + Reload. |
| 475 | MEDIUM | CONFIRMED-FIXED | 1440-fold.png | Panel status is "the request was turned down" in plain words. No "badrequest" in the footer. |
| 476 | MEDIUM | STILL-OPEN | 1440-fold.png, font-layout.json | Five equal tiles still in one row (237px×5). 7 font sizes. 14px card padding. |
| 477 | LOW | STILL-OPEN | 1440-fold.png | Empty-state tiles and "all" chips still render as filled controls. |

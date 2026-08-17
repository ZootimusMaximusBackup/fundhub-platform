# Live re-verify — client-ops (advisor / inquiry) — 2026-08-17 20:12–20:17Z

Live `https://fundhub.ai`. Harness `--no-clicks`. No 503/bounce (0 retries on every screen).

| Screen | Login | HTTP | Bounce | 503 retry |
|---|---|---|---|---|
| client-control-panel.html | advisor@fundhub.ai → funding_advisor | 200 | no | 0 |
| client-control-panel.html?client_id=8556bedc-… | advisor (cached) | 200 | no | 0 |
| messaging.html | advisor (cached) | 200 | no | 0 |
| documents.html | advisor (cached) | 200 | no | 0 |
| lenders.html | advisor (cached) | 200 | no | 0 |
| finance-os.html | advisor (cached) | 200 | no | 0 |
| finance-os.html?client_id=8556bedc-… | advisor (cached) | 200 | no | 0 |
| company-brain.html | advisor (cached) | 200 | no | 0 |
| inquiry-remover.html | inquiry@fundhub.ai → inquiry_specialist | 200 | no | 0 |

Stamps were not trusted. HOLDS only if Expected was true on this run. Click-only claims are UNVERIFIED.

| Line | Screen | Expected | Verdict | Live fact | Evidence |
|---|---|---|---|---|---|
| 346 | client-control-panel.html (bare) | Way to pick a client (search/select) | **HOLDS** | Empty state says pick a client on Pipeline. Open Pipeline is 272×43. No in-page client select. | `_reverify-live/client-control-panel/1440-fold.png` |
| 347 | client-control-panel.html (bare and client) | No coming-soon / dead controls | **HOLDS** | No “coming soon” copy on either run. Actions are Open Pipeline / Open Messaging / More links. | `_reverify-live/client-control-panel/audit.md` · `client-control-panel-client/audit.md` |
| 348 | client-control-panel.html (bare and client) | Toggles ≥40px; ≤4 sizes; no 9px labels | **DOES-NOT-HOLD** | Section toggles are 849×14. 7 sizes (18/16/14/13/12/11/10). No 9px type (10px is the Search shortcut). | `_reverify-live/client-control-panel/audit.json` · `client-control-panel-client/audit.json` |
| 350 | client-control-panel.html?client_id= | Empty Next Action is empty, not an alert | **DOES-NOT-HOLD** | TEST Client Role loaded. NEXT ACTION is “—” inside a red dashed box. | `_reverify-live/client-control-panel-client/1440-fold.png` |
| 352 | messaging.html | Send ≥44px; filter chips ≥40px | **DOES-NOT-HOLD** | Send is 74×34 (disabled). All 8 is 44×22. Needs reply 0 is 94×22. | `_reverify-live/messaging/audit.json` |
| 353 | messaging.html | Absolute time after 24h; Needs reply first | **DOES-NOT-HOLD** | List times are 1d / 2d / 3d. All 8 is first and selected; Needs reply 0 is second. | `_reverify-live/messaging/1440-fold.png` |
| 356 | documents.html | Class cards agree with KPI tiles and table | **HOLDS** | TOTAL 4. Classes 2+2+0+0=4. Table 4 rows, all Awaiting. Matches Awaiting signature 4. | `_reverify-live/documents/1440-fold.png` |
| 357 | documents.html | ≤4 sizes; 8px spacing; ≥40px; numbers right | **DOES-NOT-HOLD** | 7 sizes (28/18/14/13/12/11/10). Off-scale 14/13px. Age pending is left (`start`). 10 targets under 40px. | `_reverify-live/documents/audit.json` |
| 358 | documents.html | Active All tab not an enabled target, or click is harmless | **UNVERIFIED** | All is `tab on`, disabled=false, 50×41. `--no-clicks` so harmless-click not proven. | `_reverify-live/documents/audit.json` |
| 359 | lenders.html | Filled button is Import CSV; targets ≥40px | **DOES-NOT-HOLD** | Empty copy asks for Import CSV. Import CSV is 107×35, unfilled. Filled page button is Add blank row 126×35. 9 targets under 40px. | `_reverify-live/lenders/1440-fold.png` · `audit.json` |
| 360 | lenders.html | Same header as other screens | **HOLDS** | Breadcrumb, clock (Mon, Aug 17, 4:15:12 PM EDT), Search ⌘K, role chip, LIVE, Sign out. | `_reverify-live/lenders/1440-fold.png` |
| 363 | finance-os.html (bare and ?client_id=) | Real layout at load; beta is a bar | **HOLDS** | Bare: picker + “no client named”, not blank. Client: picker, cash-flow hero, panels. Beta bar sits above content on both. | `_reverify-live/finance-os/1440-fold.png` · `finance-os-client/1440-fold.png` |
| 364 | finance-os.html?client_id= | Advisor does not see finance-only write controls | **HOLDS** | No Add account / Add card / Add a bill / Load or Clear sample. No trigger-switch controls. Text me when shows OFF as text. | `_reverify-live/finance-os-client/audit.json` · `1440-full.png` |
| 365 | finance-os.html?client_id= | Empty Ask is disabled or tells user to type | **UNVERIFIED** | Ask is enabled (55×39). Field shows placeholder “Can I afford a $40,000 draw?”. `--no-clicks`. | `_reverify-live/finance-os-client/audit.json` |
| 366 | finance-os.html?client_id= | Text-me-when reads as paragraphs; ≤4 sizes; no ~11px text | **DOES-NOT-HOLD** | 7 sizes (28/18/14/13/12/11/10). 10px is ⌘K. Mobile reports 4 nodes under 11px. | `_reverify-live/finance-os-client/audit.md` |
| 368 | company-brain.html | Beta Dismiss and Search ⌘K are clickable | **UNVERIFIED** | Both exist and are enabled: Dismiss 64×19 on the beta bar; Search ⌘K 99×36 at y=12. `--no-clicks`. | `_reverify-live/company-brain/audit.json` · `1440-fold.png` |
| 370 | inquiry-remover.html | No alert box unless there is an alert | **HOLDS** | No red/empty alert. Copy is “No inquiries in the database yet.” / “No letters issued yet.” / “No active cases.” errorWording empty. | `_reverify-live/inquiry-remover/1440-fold.png` |
| 371 | inquiry-remover.html | System alert box hidden until it has something to say | **HOLDS** | Same paint: no empty system-alert box. | `_reverify-live/inquiry-remover/1440-fold.png` · `audit.md` |
| 372 | inquiry-remover.html | Queue Left / Worked / Calls / Confirmed have a vs; ≤4 sizes | **DOES-NOT-HOLD** | Four tiles are 0 with no vs-yesterday or vs-target. 7 sizes (28/18/14/13/12/11/10). | `_reverify-live/inquiry-remover/1440-fold.png` · `audit.md` |

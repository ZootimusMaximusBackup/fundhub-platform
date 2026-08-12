# ClickFunnels fragment polish V2 — shared board

**Status:** done (local pack green — paste pending)  
**Owner:** Grok (single thread, Chris GO 2026-08-11)  
**Pack:** `clickfunnels-fragments/`  
**Deliverable:** `clickfunnels-fragments/fixes-v2.md`  
**Do not commit** unless Chris asks.

## Owner decisions (final)

| Decision | Value |
|----------|-------|
| Model | Grok — fine |
| Threading | All in 1 thread |
| Details sidebar | HIDE (lean) |
| Add-to-calendar (task 6) | PARKED — do not build |
| Ghost wordmark crop | Approved — do not touch |
| Four-container reset | Keep (LIVE already had it) |
| `@import` first | Keep |

## Task list

| # | Unit | Status |
|---|------|--------|
| 1 | Ground — live DOM (book + apply) | done |
| 2 | Book polish — 04a / 04b | done |
| 3 | Apply polish — 02a / 02b | done |
| 4 | Harness + Playwright + grid A/B | done |
| 5 | `fixes-v2.md` + report | done |
| 6 | Add-to-calendar | parked |

## Design tokens (canonical)

- Paper `#FCFCFC` · Ink `#0A0A0A` · Line `#E4E4E7` · CTA `#188bf6`
- Grid 44px `rgba(10,10,10,.048)` via `body::before` fixed inset 0 z-index -1
- Inter + JetBrains Mono; Spectrum gradient; 900px column
- Cards: paper, 1px line, 14px radius, `0 18px 44px rgba(10,10,10,.10)`

## Live DOM brief

### Book — AppointmentScheduler/V1

_URL: https://apply.fundhub.ai/funding-book-call — scraped 2026-08-11_

Outer shell:
```
div.max-w-4xl…sm:flex
  div[class*="sm:w-1/3"][class*="bg-gray-50"]  ← DETAILS SIDEBAR (hide)
  div.w-full
    … cf2__/DTP__ calendar + slots …
    .additional-fields-container > .add-links
      .add-guest > a.add-link "+ Add Guest"
      .add-comments > a.add-link "+ Add Additional Info"
    .buttonRow > a.elButton "Book Appointment"
```

Confirm (after picking a slot):
```html
<button class="cf2__confirm-button DTP__confirm-button">Confirm</button>
```
Live before polish: white bg / black text (ghost). Not a div — flatten was a red herring for Confirm fill; real fix is button rule.

Icons: `i.fa-solid` / `i.fas` — Font Awesome 6 Pro / 5 Free.

Today: **no today class**. Day 11 had `--available --selected --focused`. Cheap underline uses `--focused`.

Time slots: `button.cf2__time-slot.DTP__time-slot` (~38px live height before min-height polish).

Flatten live (keep):  
`[data-page-element="AppointmentScheduler/V1"] div{background-color:transparent!important}`

### Apply — Survey/V1

_URL: https://apply.fundhub.ai/apply_

Progress: `.elProgressBar` > `.progress` > `.progress-bar` (already `#188bf6` fill).

Contact inputs: `.elInput.elSurveyContactInput` (Inter already on live).

Radio step (“Set Your Target Amount”):
```html
div.elSurveyItem
  div.elRadioWrapper[data-page-element="Radio/V1"]
    label.elRadioLabel
      input.elRadioInput
      span.elRadioText
```
Selected = `:has(input:checked)` → blue.

### Grey placeholder boxes below footer (mobile)

**Not found on live `/apply` @375.** Structure is one `SectionContainer/V1` containing top CustomHtml → Survey → bottom CustomHtml (`id-6Z-4Lr4ed-877` / `.fh-b`). Nothing below footer.

**For Chris:** if editor still shows two grey boxes, delete empty Image/Spacer elements **below** bottom Custom HTML in the CF editor. Do not CSS-hide.

## Selector brief (pasteable)

```css
/* Confirm */
button.cf2__confirm-button, button.DTP__confirm-button

/* Sidebar hide */
[data-page-element="AppointmentScheduler/V1"] [class*="sm:w-1/3"]

/* Guest / additional */
.add-links, .add-guest, .add-comments

/* Slots */
button.cf2__time-slot, button.DTP__time-slot

/* Icons exclude */
i.fa-solid, i.fas, i[class*="fa-"]

/* Survey selected */
.elRadioWrapper:has(input:checked)
.elProgressBar / .progress-bar
```

## Widget shells for harness

- `clickfunnels-fragments/harness/widgets/scheduler-shell.html` — real cf2__/DTP__ classes, Confirm, slots, sidebar, add-guest
- `clickfunnels-fragments/harness/widgets/survey-shell.html` — ProgressBar + elRadioWrapper options

## Change manifests

| File | Touched |
|------|---------|
| `04a-book-top.html` | LIVE sync + V2 scheduler polish |
| `04b-book-bottom.html` | LIVE sync (full-bleed bands kept) |
| `02a-apply-top.html` | LIVE sync + V2 survey polish |
| `02b-apply-bottom.html` | LIVE sync |
| `harness/*` | real shells, grid A/B pages |
| `tests/layout.spec.mjs` | 320–1920, DPR 1/2/3, scheduler asserts, artifacts |
| `fixes-v2.md` | new |

## Verify

```bash
cd clickfunnels-fragments && npm test
# 658 passed
```

## Blockers / open questions

1. Grey boxes: not on live — Chris confirm in CF editor if still there.
2. Grid A vs B: Chris picks from artifact pair (do not auto-choose).
3. Paste drop-ins into CF when ready.
4. Task 6 add-to-calendar still parked.

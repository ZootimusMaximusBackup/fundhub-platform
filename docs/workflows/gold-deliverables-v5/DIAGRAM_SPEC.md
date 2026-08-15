# UnderwriteIQ Diagram Generators - Build Spec

**For:** Darwin
**Scope:** Generate eleven diagrams inside the existing client deliverable PDFs. No new documents. No copy changes.
**Ships with:** `fh_charts.py` (working reference implementation), `fundhub_pdf_template.py` (the PDF engine)
**Status:** All eleven are built, rendering, and QA'd in the attached pack. This spec is the port instruction.

---

## 1. The one hard rule

**No model in the drawing path.**

The LLM writes prose. The renderer draws from numbers. Every chart function is a pure function of its arguments: same inputs always produce byte-identical SVG.

Three reasons this is non-negotiable:

1. **QA.** A deterministic chart can be diffed and regression-tested. A generated one cannot.
2. **Correctness.** A bar whose height is a model's guess will eventually contradict the table three inches above it.
3. **Cost.** These render in microseconds with zero tokens.

If a chart needs a number UnderwriteIQ does not already compute, compute it in the engine. Do not ask the model for it.

---

## 2. Two kinds of diagram, different jobs

Keep these separate when you wire them up. They fail in different ways.

**Explainers** teach a concept to someone who has never heard the word "utilization." The teaching lives *inside* the picture in plain words, and the whole thing has to land before the client reads a caption. These are what make the pack feel worth what it costs, and they double as the walkthrough slides for the mini course.

**Analytics** plot numbers for someone who already understands the concept. Useful, but they do not bridge understanding on their own.

| Explainers | Analytics |
|---|---|
| `score_lineup` | `utilization_bars` |
| `utilization_tank` | `waterfall` |
| `severity_scale` | `unlock_ladder` |
| `money_chain` | `timeline` |
| `journey_map` | |
| `dispute_clock` | |
| `application_order` | |

If you ever cut one for space, cut an analytic. The explainer is the product.

---

## 3. Module API

Eleven public functions, each returning an SVG string wrapped in `<div class="chart">`. Drop into a document body as `{"t": "chart", "svg": <string>}`.

```python
# explainers
score_lineup(rows, cap=None)
utilization_tank(card_name, limit, balance, target_bal, pay_amount, cap=None)
severity_scale(items, cap=None)
money_chain(steps, headline, teach, cap=None)
journey_map(cap=None)
dispute_clock(cap=None)
application_order(steps, cap=None)

# analytics
waterfall(steps, cap=None)
unlock_ladder(current, tiers, lo=620, hi=710, cap=None)
utilization_bars(rows, target_pct=10, cap=None)
timeline(months, start_score, end_lo, end_hi, lo=620, hi=720, cap=None)
```

### Rendering gotcha, already handled

WeasyPrint reads a unitless SVG `width` as **CSS pixels** (0.75pt each), silently rendering every chart at 75% scale. `_svg()` pins `width`/`height` in explicit `pt`. Do not remove those units.

### Page-break rule, already handled

`.chart` carries `break-inside: avoid`, and `h2`/`h3`/`.eyebrow`/`.rule` carry `break-after: avoid`. Without the second, a section heading strands alone at the bottom of a page while its diagram starts the next. Keep both.

---

## 4. Data contracts

I do not have repo access. This specifies **what each chart needs**, not your field names.

### 4.1 `score_lineup` - three scores, not one

```python
score_lineup([
    ("TransUnion", 725, "Nothing negative on it"),
    ("Experian",   630, "1 negative item"),
    ("Equifax",    636, "7 negative items"),
])
```

Pass in any order. The function sorts ascending, so **the middle card is literally the middle score**, and an arrow points at it. That is the entire teaching device. The note is free text, one short plain phrase per bureau.

**Watch this one.** In the sample, Equifax has 7 negatives but outscores Experian which has 1. That is real, and a beginner reads it as a contradiction. If the note strings routinely produce that effect, switch the note to something that cannot read as backwards (last updated, or file status) rather than negative counts.

### 4.2 `utilization_tank` - what "93% full" means

```python
utilization_tank("SYNCB/LEVITZ", 1894, 1762, 189, 1573)
#                 name          limit balance target pay
```

Needs one revolving card with a **known limit**: the worst offender. Percentages are computed, never passed. Use the engine's existing per-card 10% target for `target_bal`, and `balance - target_bal` for `pay`.

### 4.3 `severity_scale` - which items actually hurt

```python
severity_scale([
    (7, "STUDENT LOANS (x2)", "an error to clean up",  0.04, "a"),
    (1, "SIGNET BANK",        "worst item, fix first", 0.96, "a"),
    ...
])
# (table_number, short_name, plain_note, rail_position_0_to_1, side)
```

`table_number` must match the item's row in the negative-items table so the client can cross-reference. `rail_position` comes from **the report's own severity ranking**, not computed in the chart. `side` alternates `a`/`b` to stagger labels above and below the rail; alternate strictly or labels collide. Plain note is a short human phrase, not a status code.

### 4.4 `money_chain` - why paying pays you back

```python
money_chain([
    ("STEP 1",           "Pay two cards",        "$1,573 + $367"),
    ("WHAT CHANGES",     "Cards drop under 10%", "utilization falls from 97%"),
    ("WHAT LENDERS SEE", "Score jumps",          "+40 to 80 points"),
    ("WHAT YOU GET",     "Pre-approval jumps",   "$7,936 becomes $19,841"),
], headline, teach)
```

Four panels is the tested width. The renderer takes three or five, but five gets cramped. The last panel gets the emphasis treatment automatically.

### 4.5 `journey_map` - the fundability journey

Currently hardcoded to the two-track shape: start, fund-now track and repair-rounds track running in parallel, merging at the re-check into the bigger number. This is the Capital Conveyor Belt idea from the VSL, which until now appeared nowhere in the deliverables.

**Parameterize this one when you port it.** It needs current pre-approval, projected pre-approval, number of dispute rounds, and whether the client has a clean bureau to apply against at all. A repair-only client has no Track 1, and drawing one would be a lie. Suppress the track rather than draw an empty one.

### 4.6 `dispute_clock` - why this takes months

No data. Identical for every client: send, 30-day clock, results come back deleted or updated or verified, verified items loop to the next round. Static.

Worth its space because it pre-empts the "why is this taking so long" question that otherwise arrives as a refund request.

### 4.7 `application_order` - the order protects your score

```python
application_order([
    ("Fix utilization first",    "PAY SYNCB/LEVITZ DOWN TO $189"),
    ("Lowest score floor first", "NAVY FEDERAL AT 650 / KABBAGE AT 640"),
    ...
])
```

Bold line is the rule, sub line is the client's specific instance of it. Draws the numbered path with the shotgun anti-pattern crossed out beside it. Five steps is the tested height.

### 4.8 - 4.11 Analytics

`waterfall(steps)` where steps are `(label, sublabel, value, kind)` and kind is `base`/`gain`/`total`. Gain bars float on the running total; `total` must be the largest value. **Do not split the delta into causes the copy does not attribute.**

`unlock_ladder(current, tiers)` where tiers are `(score_floor, [lender names])` ascending. `+N PTS` is computed. Names wrap at 58 chars. Widen `lo`/`hi` if a tier falls outside or the gate tick renders off-rail. Note: this diagram renders the lender list with visual precision, so if the underlying list is a generalized shortlist rather than a matched set, keep the caption honest about that. The picture will read as more exact than the data behind it.

`utilization_bars(rows)` where rows are `(label, pct, detail)`. **Exclude any card with an unknown limit.** BENEFICIAL in the sample has a balance but no reported limit, so its utilization is unknowable. It stays in the table where the copy explains it. A bar implies a measurement; do not draw one you cannot make.

`timeline(months, start_score, end_lo, end_hi)`. The band is **anchored, not interpolated**: drawn between the current score and the month 6 projected range only. Months 2 through 5 carry no plotted value because the roadmap states none. Do not fabricate intermediate points to smooth the curve.

---

## 5. Placement map

| Document | Section | Diagram | Kind |
|---|---|---|---|
| `credit_analysis_report.pdf` | after the lead, before section 01 | `journey_map` | explainer |
| | 02 / SCORES, above the cards | `score_lineup` | explainer |
| | 03 / UTILIZATION, above the bars | `utilization_tank` | explainer |
| | 03 / UTILIZATION | `utilization_bars` | analytic |
| | 05 / NEGATIVES, after the table | `severity_scale` | explainer |
| | 08 / BOTTOM LINE, after the cards | `money_chain` | explainer |
| `funding_snapshot.pdf` | 01 / NUMBERS | `waterfall` | analytic |
| `lender_match_list.pdf` | 01 / AVAILABLE NOW | `unlock_ladder` | analytic |
| | 03 / APPLICATION ORDER | `application_order` | explainer |
| `optimization_roadmap.pdf` | 01 / PROJECTION | `timeline` | analytic |
| | 03 / MONTHS 2-3 | `dispute_clock` | explainer |

Page cost: report 10 to 12, snapshot 8 to 9, lender list 9 to 10, roadmap 14 to 15. Four pages across the pack.

The `unlock_ladder` placement is deliberate. Section 01 used to end on "no lenders matched." It now ends on the map.

**Ceiling: six visuals in the report.** Past that it stops reading as a premium report and starts reading as a comic book. It is at six now. A seventh means removing one.

---

## 6. Edge cases

**Suppress the chart rather than draw a misleading one.** A missing diagram reads as a clean document. A wrong diagram reads as a broken product.

| Condition | Behavior |
|---|---|
| projected <= current | suppress `waterfall` and `money_chain` |
| no clean bureau to apply against | suppress Track 1 in `journey_map` |
| lender set empty | suppress `unlock_ladder` |
| current score above every tier | draw; all rows read `UNLOCKED` |
| tier threshold outside `lo`/`hi` | widen the range |
| no revolving card with a known limit | suppress `utilization_tank` and `utilization_bars` |
| single card only | draw bars, no aggregate row |
| utilization above 100% | fill clamps at 100%, printed percentage stays true |
| fewer than 3 negative items | suppress `severity_scale`, the rail needs spread to mean anything |
| no stated month 6 range | suppress `timeline` |
| any figure would be invented to fill a slot | suppress |

---

## 7. Design lock

| Token | Value | Use |
|---|---|---|
| ink | `#0C0C0D` | bars, rails, markers, fills, arrows |
| track | `#E8E8EB` | empty bar track, inactive rail |
| hairline | `#DDDDE1` | separators, leader lines |
| label | `#6E6E76` | mono axis and caption text |
| muted | `#9A9AA1` | secondary text, dashed connectors |
| spectrum | standard gradient | **thin accents only, never a fill** |

- Every number is JetBrains Mono. Every name is Inter.
- **Every chart must read correctly in grayscale.** No meaning carried by hue alone. Clients print these.
- Spectrum appears only as 2 to 2.4pt hairlines: the highlighted card's top edge, the gain bar's top edge, the timeline's projected range bar. Nothing else.
- Plain language inside the frame. No jargon in a diagram label. If a word needs a definition, the diagram has failed.

---

## 8. QA gates

The build passes all five. Wire them into CI.

1. **Proportion check.** Rasterize at 150dpi, measure bar pixel dimensions, assert ratios match input values within 1%. Current: waterfall 0.402 vs 0.400 expected, utilization 0.741 vs 0.742 and 1.044 vs 1.043.
2. **Color discipline.** Scan every page for pixels above 0.45 saturation and 0.55 value. Assert every contiguous colored band is under 10px at 150dpi. A thick band means a gradient leaked into a fill. This check caught a real bug where `background-size` failed to clip a gradient and flooded every metric card.
3. **Footer clearance.** Assert no dark pixels between 727pt and 741pt on light pages.
4. **Text layer.** Assert every chart label appears in `pdftotext` output. SVG text stays selectable; a vanished label means a font failed to resolve. Note that `pdftotext` inserts spaces into letter-spaced mono text, so normalize whitespace before matching.
5. **Dash check.** Assert no em-dash or en-dash in the four report-style docs. Dispute letters are exempt; their source copy legitimately contains them.

---

## 9. One open item, unrelated to diagrams

**Six letters still render body-less.** The three inquiry-removal and three personal-info letters arrive from the generator with header content only, so they render as sender block, date, recipient, and a Re: line with nothing under it. Generator fix, not a layout one.

---

## 10. Letters ship unbranded (done)

`render_letter()` emits **zero Fundhub branding**: no wordmark, no mono tag, no spectrum rule, no page footer, and no author metadata. `css()` takes `plain=True` for this, which drops the `@bottom-left` and `@bottom-right` content entirely.

The sender block now sits at the top, above the date, in standard business-letter order, so the letter reads as something the client wrote themselves.

Two reasons this is a hard requirement, not a preference:

1. **Deliverability.** A dispute letter that looks broker-generated gets routed to the suspicious-source pile and can be dismissed as a third-party or frivolous dispute. The branding actively lowers the success rate.
2. **Exposure.** A logo on a dispute letter is documentary evidence that Fundhub prepared it, which converts a "we give clients tools" position into a "we performed credit repair services" position.

Verified in CI by the letter-cleanliness gate: assert no branding strings in the text layer, no author metadata, and **zero saturated pixels** on any letter page. Any color at all on a letter means branding leaked back in.

The client-facing reports keep full branding. Only letters go plain.

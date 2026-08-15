# Gold deliverables v5 — 2026-08-14

**Owner law:** Pack PDFs must look **exactly** like the gold files in `docs/workflows/gold-deliverables-v5/`. Those files **are** the templates — carbon copy. Fill them with Underwrite IQ data only. Do **not** recreate look/fonts in the JS letter drawer. Letters: no Fundhub branding. Charts: no model in the draw path. QR on report close page → `https://apply.fundhub.ai`.

**Bar:** empty letter body → do not ship. JSON dumped into a report → do not ship. `[ QR CODE ]` placeholder → do not ship. Lookalike Helvetica letters → do not ship.
 empty letter body → do not ship. JSON dumped into a report → do not ship. `[ QR CODE ]` placeholder → do not ship.

| Unit | Owner | Status |
|------|-------|--------|
| W0 Unpack gold + command center | this chat | claimed — fan-out 1:16pm |
| W1 Letters = gold letter PDFs + LETTER_SPEC bodies | agent | done |
| W2 Diagrams = fh_charts.py in reports | W2 | done |
| W3 Report shell = fundhub_pdf_template.py look | this chat | done |
| W4 QR → apply.fundhub.ai on report CTA page | Grok 4.6 extra-high | done |
| W6 Old CRS letter-delivery.js uses new generator | Grok 4.5 high | done |
| W7 Gold vs live PDF text extract | Grok 4.5 high | done |
| W8 Letter typeface Inter + JetBrains Mono | — | **cancelled** — owner: no JS font recreation; carbon-copy gold templates + UIQ data |
| G1 Bring gold pack onto working branch | Grok 4.5 | **done** |
| G2 Map UIQ data → `render_letter(spec)` | Grok 4.5 | **done** |
| G3 Wire pack generation to gold Python printer | Grok 4.5 | superseded — Node pdf-lib + Inter/JBM (Netlify-safe) |
| G4 Kill external UIQ/Vercel letter webhooks | Grok 4.5 | **done** — ds-02/c-06 in-repo letter-pack |

**File fences (do not cross):**
- W3: `vendor/underwriteiq-full/api/lite/crs/gold-report-shell.js`, `src/underwrite/gold-report-shell.test.mjs` only
- W4: `vendor/underwriteiq-full/api/lite/crs/apply-qr.js`, `src/underwrite/apply-qr.test.mjs` only
- W6: `vendor/underwriteiq-full/api/lite/letter-delivery.js` + its tests only
- W7: new files under `docs/workflows/gold-deliverables-v5/compare/` only
- W8: cancelled (do not touch JS letter-generator for typeface)
- G2/G3: gold `fundhub_pdf_template.py` + UIQ data map only — carbon copy, not a lookalike

Gold files: `docs/workflows/gold-deliverables-v5/` (from `fundhub_deliverables_v5.zip`). Specs: `LETTER_SPEC.md`, `DIAGRAM_SPEC.md` there.

Do not `--prod`. Do not drain outbox. Do not commit unless Chris asks.

---

## G2+G3 manifest — UIQ data → gold Python printer (done 2026-08-14)

**COMPLIANCE REVIEW REQUIRED** — dispute letter PDF path (same Metro 2 / FCRA bodies; print engine switched to gold WeasyPrint template).

**Owner law:** Carbon copy of uploaded templates. Underwrite IQ fills data only.

**What shipped**

- Gold `letter-generator.js` + `letter-pack.mjs` (and shims/tests) brought from `origin/cursor/resume-gold-break-1dea`.
- `renderPlainLetter` no longer paints Helvetica via pdf-lib. It spawns `docs/workflows/gold-deliverables-v5/render_letter_cli.py` → `fundhub_pdf_template.render_letter`.
- Fonts bundled at `docs/workflows/gold-deliverables-v5/fonts/` (Inter + JetBrains Mono). Template `css()` loads them via `@font-face`.
- Python: Homebrew `weasyprint` (`WEASYPRINT_PYTHON=/opt/homebrew/opt/weasyprint/libexec/bin/python` or auto-detected).

**Prove**

- Smoke PDF `/tmp/fh-node-gold-letter.pdf`: `pdffonts` shows **Inter + JetBrains Mono**, not Helvetica.
- Layout/body matches gold sample structure (SIGNET Field 21/24/20, ENCLOSURES).
- Tests green with `WEASYPRINT_PYTHON` set:
  - `letter-generator.test.js` 19/19
  - `letter-generator.test.mjs` (included in run)
  - `letter-pack.test.mjs` 10/10
  - `letter-delivery.test.js` 22/22

**Files**

- `vendor/underwriteiq-full/api/lite/letter-generator.js`
- `docs/workflows/gold-deliverables-v5/render_letter_cli.py` (new)
- `docs/workflows/gold-deliverables-v5/fundhub_pdf_template.py` (`@font-face` only)
- `docs/workflows/gold-deliverables-v5/fonts/*.ttf` (new)
- gold letter-pack / delivery / tests from resume-gold branch

**Not done**

- Netlify functions do not ship WeasyPrint yet — live letter print needs that runtime (or a host that has it). Local/prove path works.
- No `--prod`. No commit unless Chris asks.

---

## G1 manifest — gold pack on branch (done 2026-08-14)

**Owner law (restated):** The PDFs/Python in `docs/workflows/gold-deliverables-v5/` **are** the templates. Carbon copy. Underwrite IQ supplies data only. Do not recreate fonts/look in JS.

**What shipped**

- Checked out from `origin/cursor/resume-gold-break-1dea` onto this branch:
  - `docs/workflows/gold-deliverables-v5/` (sample letter + report PDFs, `fundhub_pdf_template.py`, `fh_charts.py`, `LETTER_SPEC.md`, `DIAGRAM_SPEC.md`, `compare/`)
  - `docs/workflows/gold-deliverables-v5.md` (board)
- W8 cancelled on this board. G2/G3 queued.
- Bland A6 font recreation already cancelled on `docs/workflows/bland-agents-prove.md`.

**Runnable needs for G2/G3 (not installed yet — do not invent a JS fallback)**

- Python package `weasyprint` — **missing** on this machine (`ModuleNotFoundError`).
- System fonts named **Inter** and **JetBrains Mono** — not confirmed installed here. The gold template CSS calls those family names; without them a print will silently substitute and will **not** match the samples.
- No `--prod`. No commit.

**Not done (G2/G3)**

- Map UIQ engine output → `render_letter(spec)`.
- Point pack generation at the gold Python printer so shipped PDFs are carbon copies of these templates with live data.

---

## W4 manifest — apply QR (done 2026-08-14)

The close-page QR encodes **`https://apply.fundhub.ai`**. It does **not** encode a booking-call URL. The generator never draws `[ QR CODE ]`.

**Phone scan (honest):** A phone **should** scan it. The matrix independently decodes to that URL. Reed-Solomon check bytes match a second encoder on the same data. Draw is black squares on a white 128pt box with a 4-module quiet zone (needed because the close page is dark). We did **not** point a camera or OpenCV at a rendered PDF. Remaining risk: a PDF viewer leaving hairline gaps between squares — modules overlap 5% to close that.

**How we proved the payload**

1. Default `APPLY_PAGE_URL` is `https://apply.fundhub.ai` (24 bytes, QR version 2, error level M).
2. Test decoder is independent of the encoder: read format bits (BCH round-trip), unmask, ISO zigzag (Nayuki column rule), byte mode → payload. Must equal the apply URL.
3. Compared to Python `segno`: segno adds 8 extra zero bits when the stream is already byte-aligned (a segno bug). Our pad is `0xEC 0x11` per the spec. ECC over that spec data matches segno’s RS routine.

**Tests:** `node --test src/underwrite/apply-qr.test.mjs` — **7/7** pass.

**Files changed**

- `vendor/underwriteiq-full/api/lite/crs/apply-qr.js` — real encoder; quiet zone 4; 5% module overlap on draw. Exports `APPLY_PAGE_URL`, `encodeQrMatrix`, `drawQrOnPdfPage`.
- `src/underwrite/apply-qr.test.mjs` — decode + quiet-zone tests. No new npm dependency.
- `docs/workflows/gold-deliverables-v5.md`

**Not touched:** `gold-report-shell.js` (W3 already calls `drawQrOnPdfPage` at 128pt). Caption / URL text on the close page is W3. No commit. No `--prod`.

**Leftover**

- No camera / zbar / OpenCV scan of a PDF page (those tools are not in this environment).
- Versions 5–10 still use a simplified block table and 8-bit byte-mode length. The apply URL is version 2, so that does not matter for this QR.
- Mask scoring skips the finder-lookalike penalty. Still a valid mask; payload decodes.
- `BOOKING_URL` is not read here. W3 always draws the apply URL.

---

## W2 manifest — charts (done 2026-08-14)

**What shipped**

- `src/underwrite/fh-charts.mjs` — 11 gold chart functions. Pure numbers → SVG. No model.
- `src/underwrite/fh-charts-embed.mjs` — pdf-lib cannot embed SVG, so this draws the closed primitive set onto a page. No new npm dep.
- `src/underwrite/fh-charts.test.mjs` — 18/18 pass (`node --test src/underwrite/fh-charts.test.mjs`). Same args → identical SVG. Width/height in `pt`. Gold labels present.
- Default args match the Python gold file byte-for-byte (checked all 11).

**W3: how to import**

W3 already loads `src/underwrite/fh-charts.mjs` in `gold-report-shell.js` (`loadFhCharts`). `tryFhChart` still does not paint. Paint in `renderChartSlot`:

```js
const { drawChart, unwrapChart } = ctx.charts; // re-exported from fh-charts.mjs
const svg = tryFhChart(ctx.charts, node.name, node.args);
if (!svg) return;
const { heightPt } = unwrapChart(svg);
if (ctx.y - heightPt < 72) { /* new page, W3 owns this */ }
drawChart(activePage(ctx), svg, {
  x: MARGIN,                 // 52
  y: ctx.y - heightPt,       // pdf-lib bottom-left of the chart box
  fonts: {
    sans: ctx.font,          // embed Inter when you have the files
    sansBold: ctx.bold,
    mono: ctx.mono,          // embed JetBrains Mono when you have the files
    monoBold: ctx.monoBold
  }
});
ctx.y -= heightPt + 15;
```

Direct ESM import if you are not going through loadFhCharts:

```js
import { score_lineup, journey_map /* … */ } from "../../../../src/underwrite/fh-charts.mjs";
import { drawChart, unwrapChart } from "../../../../src/underwrite/fh-charts-embed.mjs";
```

**Choice documented:** pdf-lib has no SVG embed. Rasterizing would kill selectable text (QA gate 4). So W2 draws primitives (rect/line/polygon/circle/path/text + 2pt spectrum slices). Helvetica/Courier will render; gold type is Inter + JetBrains Mono — W3 embeds those fonts.

**Exports (same shapes as Python)**

| fn | args |
|----|------|
| `score_lineup(rows, cap?)` | `rows: [name, score, note][]` |
| `utilization_tank(card_name, limit, balance, target_bal, pay_amount, cap?)` | |
| `severity_scale(items, cap?)` | `items: [table_num, short_name, plain_note, rail_0_to_1, "a"\|"b"][]` |
| `money_chain(steps, headline, teach, cap?)` | `steps: [kicker, bold, sub][]` |
| `journey_map(cap?, opts?)` | `opts`: `{ currentApproval, projectedApproval, disputeRounds, hasCleanBureau }` — omit opts for gold two-track. `hasCleanBureau: false` hides Track 1. |
| `dispute_clock(cap?)` | static |
| `application_order(steps, cap?)` | `steps: [bold, sub][]` |
| `waterfall(steps, cap?)` | `steps: [label, sublabel, value, "base"\|"gain"\|"total"][]` |
| `unlock_ladder(current, tiers, lo=620, hi=710, cap?)` | `tiers: [score, names[]][]` |
| `utilization_bars(rows, target_pct=10, cap?)` | `rows: [label, pct, detail][]` |
| `timeline(months, start_score, end_lo, end_hi, lo=620, hi=720, cap?)` | `months: [n, phase, action, note\|null][]` |

Each returns `<div class="chart"><svg width="508pt" height="Npt" …>`. Suppress rules in DIAGRAM_SPEC §6 are the caller’s job — do not call the chart if the picture would lie.

**Not touched:** W1 letters, W4 QR, `vendor/.../render-pdf.js` page layout.

**Left for W3:** wire `drawChart` into `renderChartSlot`, page-break before a chart that will not fit, embed Inter + JetBrains Mono.

---

## W1 manifest — letters (done 2026-08-14)

**COMPLIANCE REVIEW REQUIRED** — dispute letter wording, FCRA cites, and Metro 2 field claims.

**What shipped**

- `vendor/underwriteiq-full/api/lite/letter-generator.js` — letters now follow the gold layout: sender, date, bureau, Re: line, body, signature, ENCLOSURES. No Fundhub word, no logo, no color bar, no page footer.
- Empty item list → **no letter**. TransUnion with 0 inquiries → no inquiry letter. Never a header-only page.
- Bureau dispute: one Round 1 PDF per bureau that has derogatory accounts. Itemized Field 21 / Field 24 / Field 20 like gold `dispute_experian_bureau.pdf` (SIGNET BANK).
- Inquiry letters: real list + FCRA 604.
- Personal-info letters: names, SSN (last four only), addresses, employers, date of birth + FCRA 611.
- Round 2 / Round 3 templates exist (method of verification / CFPB). They only print if a tradeline has `priorOutcome: "verified"` or `"verified_round2"`. No new outcome screen.
- `src/underwrite/letter-pack.mjs` passes full tradelines, inquiry lists, and identity into the generator. Funding pack and repair pack pick this up through `generateLetters`.

**Tests (green)**

- `node --test src/underwrite/letter-generator.test.mjs src/underwrite/letter-pack.test.mjs` — 13/13
- `node --test vendor/underwriteiq-full/api/lite/__tests__/letter-generator.test.js` — 10/10
- Lint parse clean

Checked vs gold `dispute_experian_bureau.pdf`: both 2 pages; sender / street / Experian / SIGNET / Field 21 / 24 / 20 / REQUESTED ACTIONS / ENCLOSURES present; no `fundhub` / `FundHub` in PDF text or raw bytes.

**Files changed**

- `vendor/underwriteiq-full/api/lite/letter-generator.js`
- `vendor/underwriteiq-full/api/lite/__tests__/letter-generator.test.js`
- `vendor/underwriteiq-full/api/lite/__tests__/letter-delivery.test.js` (empty-pack counts now 0)
- `src/underwrite/letter-pack.mjs`
- `src/underwrite/letter-pack.test.mjs`
- `src/underwrite/letter-generator.test.mjs` (new)
- `docs/workflows/gold-deliverables-v5.md`

**Not done**

- Letters use Helvetica (already in the app). Gold uses Inter + JetBrains Mono via Python. Same page order, not the same typeface.
- The older CRS path `generateLettersFromCRS` in `letter-delivery.js` still builds letters from specs without the new item lists.
- Round 2/3 need a later `priorOutcome` on each account. No capture UI was added.

---

## W3 manifest — report shell (done 2026-08-14, leftover closed)

Reports may brand Fundhub. Letters were not changed. `apply-qr.js` was not edited.

**What shipped (this leftover pass)**

- `loadFhCharts` now merges W2 `drawChart` / `unwrapChart` from `fh-charts.mjs` + `fh-charts-embed.mjs`. Charts paint. A chart that will not fit page-breaks via `ensureSpace`.
- Cover OUTCOME prefers `FULL_FUNDING` / `FUNDING_PLUS_REPAIR` / `PREMIUM_STACK` / `REPAIR_ONLY` from `engine.outcome`, `outcome_tier`, `client.outcome_tier`, or `personal.outcome_tier` over engine `MANUAL_REVIEW`.
- Live engine `preapprovals.totalCombined` feeds `journey_map`, `waterfall`, and `money_chain` (not just `.total`).
- `unlock_ladder` / `application_order` draw on lender-match when matches exist (or `matchLenders` can compute them). Empty lender set → suppress.
- `timeline` takes a real months array. Still suppressed unless `projectedScoreRange` is stated (DIAGRAM_SPEC §6).
- Missing / lying data still suppresses: projected ≤ current, no revolving limit, fewer than 3 negatives, no current pre-approval for the journey map.
- Dark cover + spectrum hairline + chips + callouts + dark close page. Never prints `[ QR CODE ]`. `DRAW_QR_HERE` still calls W4 when present.
- Inter / JetBrains Mono: **not embedded**. No `.ttf`/`.otf` in the repo or gold folder. pdf-lib also needs `fontkit` for custom fonts, which is not a dependency. Reports stay Helvetica + Courier. No new npm dep (ask first).

**Tests:** `node --test src/underwrite/gold-report-shell.test.mjs` — 17/17. Related `render-pdf-content-nodes.test.js` — 4/4. No skipped tests.

**Files changed (this leftover pass)**

- `vendor/underwriteiq-full/api/lite/crs/gold-report-shell.js`
- `src/underwrite/gold-report-shell.test.mjs`
- `docs/workflows/gold-deliverables-v5.md`

**Remaining visual gaps vs gold**

- Typeface is Helvetica + Courier, not Inter + JetBrains Mono. Same gap as letters until font files + fontkit exist.
- Spectrum is six flat color slices, not a true blend.
- Chips are square (pdf-lib has no round corners here).
- `timeline` stays off until the engine states a month-6 score range. It does not invent one.
- `summary_funding_snapshot.pdf` still comes from `summary-doc-generator.js`, not this shell.
- Cover titles are ours (`Your Credit Analysis Report`, etc.). Gold PDFs are compressed so exact gold cover copy was not readable.
- Claude markdown still will not look as tight as gold `{ t: "metrics" | "lender" | "card" }` blocks unless the model emits that JSON (which we parse).

---

## W7 manifest — gold vs live text extract (done 2026-08-14)

**Fence:** only `docs/workflows/gold-deliverables-v5/compare/` + this section. No generator/renderer/letter-pack edits.

**What shipped**

- 14× `compare/gold-*.txt` via `extractPdfText` (pdfjs).
- Live letter: Jordan Sample → `compare/live-letter-experian-bureau.txt` (+ other `live-letter-*.txt`). Free, no Claude.
- Live report: fixture markdown → `compare/live-report-credit-analysis.txt`. No Claude (would spend ANTHROPIC).
- `compare/GAPS.md` — scorecard + top gaps.

**Gates**

- Letters Fundhub: none on gold or live.
- Gold inquiry/personal (6): header-only extracts (~140 chars) — missing bodies.
- Gold reports (4): still `[ QR CODE ]` + `www.fundhubbookingurl.template`; no apply.fundhub.ai.
- Live report close: `apply.fundhub.ai` present; no QR placeholder.

**Not done / not touched:** generators, renderers, letter-pack, commit, prod, email.

---

## W6 manifest — CRS letter-delivery → W1 generator (done 2026-08-14)

**COMPLIANCE REVIEW REQUIRED** — dispute letter delivery path (same Metro 2 / FCRA bodies as W1; no body rewrites in this unit).

**What shipped**

- `generateLettersFromCRS()` no longer builds header-only PDFs with `createCRS*Letter`.
- CRS uses W1 helpers: `generateDisputeLetters` / `generateInquiryLetters` / `generatePersonalInfoLetters` (same item lists + empty suppression).
- Specs alone with no tradelines/inquiries/identity → **0 letters**. Never invent accounts.
- `deliverLetters` CRS path passes `bureaus` (or builds them from `crsResult.normalized` when present).
- fieldKeyMap only for letters that actually emit.

**Tests**

- `NODE_ENV=test node --test vendor/underwriteiq-full/api/lite/__tests__/letter-delivery.test.js` — **22/22** pass.
- Empty item list → 0 letters (new assertion). Existing path / GHL field-key regression kept.

**Files changed**

- `vendor/underwriteiq-full/api/lite/letter-delivery.js`
- `vendor/underwriteiq-full/api/lite/__tests__/letter-delivery.test.js`
- `docs/workflows/gold-deliverables-v5.md`

**Not done**

- Old `deliver-letters.js` still calls `deliverLetters` with specs + personal only (no bureaus). That path now correctly ships 0 letters until a caller passes bureau data or `crsResult.normalized`.
- Did not touch `letter-generator.js`, gold-report-shell, apply-qr, commit, or prod.


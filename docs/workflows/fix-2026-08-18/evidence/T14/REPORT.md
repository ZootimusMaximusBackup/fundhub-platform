# T14 — Apply funnel, public pages & education

Re-walked live on **2026-08-19** against `https://fundhub.ai` and `https://apply.fundhub.ai`.
No payment taken. No credit pull. No text messages. No real person's file opened.

## What still broke when we checked again

| # | Item | Reproduced? | Proof |
|---|------|-------------|-------|
| T14-01 | Thank-you page says "Your Call Is Booked" to anyone | **Yes** | `live-thank-you.html` — the words are baked into the page with nothing checking a booking |
| T14-02 | `/book` shows a 404 | **Yes** (owner says do not fix) | `http-status.json` — 404 |
| T14-04 | Education / Affiliates lower page never scrolled | **Checked now — fine** | `scroll-audit.json` |
| T14-05 | Apply funnel pages load | **Still fine** | `http-status.json` — all 200 |
| T14-06 | Eight public pages load | **Still fine** | `http-status.json` — all 200 |
| T14-07 | Follow-up job fails every time | **Main cause already fixed** | job was switched back on in commit `f3fb9a7`; a second, separate fault was still live and is fixed here |
| T14-09 | Apply still says "Step 1 of 2" on step 2 | **Yes** | `live-apply.html` — "Step 1 of 2" is in the page, "Step 2 of 2" appears nowhere at all |
| T14-10 | Apply rejects a 555 phone number | **Yes — not ours to fix** | the phone box and its error message are ClickFunnels' own; the words "invalid country code" appear nowhere in our code |

## Proof the thank-you fix works

Same page, two visitors:

- `T14-01-fixed-no-booking.png` — someone who never booked. Now reads
  "We've Got Your Application." The calendar buttons are hidden. The words
  "Your Call Is Booked" appear nowhere on the page.
- `T14-01-fixed-with-booking.png` — someone who did book. Reads
  "Your Call Is Booked." with their date, time and calendar buttons, exactly as before.

## The catch

The apply, booking and thank-you pages are **not hosted by us**. They live in
ClickFunnels. Our repo only holds the paste-in blocks. So these two fixes are real
and proven, but nothing changes on the live site until a person pastes them into
the ClickFunnels page editor. See the task report.
